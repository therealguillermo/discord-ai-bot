import {
  ChatInputCommandInteraction,
  Events,
  Routes,
  SlashCommandBuilder,
  type Client,
  type Message,
  type PartialMessage,
  type SendableChannels,
} from "discord.js";
import Anthropic from "@anthropic-ai/sdk";
import { characters } from "./agent/characters/index.js";
import { runAgent, clearHistory } from "./agent/loop.js";
import { canControlDiscord, isAuthorized, isChannelAllowed } from "./auth.js";
import { config } from "./config.js";
import { takeCrewTurn } from "./crew/chain.js";
import { startChatBots, stopChatBots } from "./crew/chatBots.js";
import { crewIdsIn, describeCrew, isCrewUser, messageAddresses, registerCrewMember } from "./crew/roster.js";
import { hearsInterjection, holdFloor, noteHumanMessage, roomTranscript, taskHuman } from "./crew/room.js";
import { createDiscordClient, createRest } from "./discord.js";
import { features, startFeatures, stopFeatures } from "./features/index.js";
import { audit, requestConfirmation } from "./safety/confirm.js";
import { endpointCount } from "./tools/discordCall.js";
import type { ToolContext, ReplyDraft } from "./tools/types.js";

const client = createDiscordClient();
const rest = createRest();

const NO_MENTIONS = { parse: [] as never[] };
const USER_MENTIONS = { parse: ["users"] as ("users")[] };
const MAX_DISCORD_LEN = 1900;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function chunk(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim() || "Done.";
  while (rest.length > MAX_DISCORD_LEN) {
    let cut = rest.lastIndexOf("\n", MAX_DISCORD_LEN);
    if (cut < MAX_DISCORD_LEN / 2) cut = MAX_DISCORD_LEN;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}

/** How the agent talks back for one request (message reply vs. slash command). */
interface Responder {
  update: (text: string) => Promise<void>;
  finish: (text: string) => Promise<void>;
}

function createReplyDraft(): ReplyDraft {
  return {
    embeds: [],
    stickerIds: [],
    set(next) {
      this.content = next.content;
      this.embeds = next.embeds;
    },
  };
}

function messageResponder(working: Message, channel: SendableChannels, reply: ReplyDraft): Responder {
  return {
    update: async (text) => {
      await working.edit({ content: text, allowedMentions: NO_MENTIONS }).catch(() => undefined);
    },
    finish: async (text) => {
      if (reply.embeds.length || reply.stickerIds.length) {
        await finishRich(text, reply, {
          edit: (body) => working.edit(body),
          send: (content) => channel.send({ content, allowedMentions: USER_MENTIONS }).then(() => undefined),
        });
        return;
      }
      const [first, ...others] = chunk(text);
      await working.edit({ content: first, allowedMentions: USER_MENTIONS }).catch(() => undefined);
      for (const part of others) await channel.send({ content: part, allowedMentions: USER_MENTIONS });
    },
  };
}

function interactionResponder(interaction: ChatInputCommandInteraction, reply: ReplyDraft): Responder {
  return {
    update: async (text) => {
      await interaction.editReply({ content: text, allowedMentions: NO_MENTIONS }).catch(() => undefined);
    },
    finish: async (text) => {
      if (reply.embeds.length || reply.stickerIds.length) {
        await finishRich(text, reply, {
          edit: (body) => interaction.editReply(body),
          send: (content) => interaction.followUp({ content, allowedMentions: USER_MENTIONS }).then(() => undefined),
        });
        return;
      }
      const [first, ...others] = chunk(text);
      await interaction.editReply({ content: first, allowedMentions: USER_MENTIONS }).catch(() => undefined);
      for (const part of others) await interaction.followUp({ content: part, allowedMentions: USER_MENTIONS });
    },
  };
}

async function finishRich(
  text: string,
  reply: ReplyDraft,
  transport: {
    edit: (body: {
      content: string | null;
      allowedMentions: typeof NO_MENTIONS | typeof USER_MENTIONS;
      embeds?: ReplyDraft["embeds"];
      stickers?: string[];
    }) => Promise<unknown>;
    send: (content: string) => Promise<void>;
  },
): Promise<void> {
  const caption = text.trim() || reply.content || "";
  const [first, ...others] = caption ? chunk(caption) : [null];
  const body = {
    content: first,
    allowedMentions: USER_MENTIONS,
    ...(reply.embeds.length ? { embeds: reply.embeds } : {}),
    ...(reply.stickerIds.length ? { stickers: reply.stickerIds.slice(0, 3) } : {}),
  };
  try {
    await transport.edit(body);
  } catch (err) {
    console.error("[reply] failed to attach sticker or embed:", err);
    await transport.edit({
      content: first,
      allowedMentions: USER_MENTIONS,
      ...(reply.embeds.length ? { embeds: reply.embeds } : {}),
    }).catch(() => undefined);
  }
  for (const part of others) {
    if (part) await transport.send(part);
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Ah mate, the Anthropic API key got rejected. Check ANTHROPIC_API_KEY.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Oi, Anthropic's rate limitin' me. Give it a moment and try again.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `The model "${config.model}" wasn't found, mate. Check ANTHROPIC_MODEL.`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status ?? "unknown"}): ${err.message}`.slice(0, 500);
  }
  return `Somethin' went wrong, mate: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
}

async function handleRequest(params: {
  client: Client;
  requesterId: string;
  requesterName: string;
  discordControl: boolean;
  channelId: string;
  triggerMessageId?: string;
  channel: SendableChannels | null;
  guildName: string;
  text: string;
  fromCrew?: boolean;
  crewNote?: string;
  /** Recent channel lines so this turn sits in the same chat. */
  room?: string;
  responder: Responder;
  reply: ReplyDraft;
}): Promise<void> {
  const { channel } = params;
  const ctx: ToolContext = {
    client: params.client,
    rest,
    guildId: config.guildId,
    requesterId: params.requesterId,
    discordControl: params.discordControl,
    channelId: params.channelId,
    triggerMessageId: params.triggerMessageId,
    confirm: async (summary) => {
      if (!channel) return false;
      return requestConfirmation(channel, params.requesterId, summary);
    },
    reply: params.reply,
  };

  try {
    const result = await runAgent({
      channelKey: params.channelId,
      requesterName: params.requesterName,
      text: params.text,
      guildName: params.guildName,
      botName: params.client.user?.username ?? "Agent",
      character: "sassy",
      fromCrew: params.fromCrew,
      crewNote: params.crewNote,
      room: params.room,
      ctx,
      onProgress: (status) => params.responder.update(status),
    });
    console.log(
      `[agent] ${params.requesterName}: ${result.iterations} iteration(s), ` +
        `${result.inputTokens} in / ${result.outputTokens} out tokens`,
    );
    await params.responder.finish(result.text);
  } catch (err) {
    console.error("[agent] request failed:", err);
    await audit({
      requesterId: params.requesterId,
      channelId: params.channelId,
      tool: "agent",
      input: params.text,
      outcome: "error",
      detail: err instanceof Error ? err.message : String(err),
    });
    await params.responder.finish(friendlyError(err));
  }
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                   */
/* -------------------------------------------------------------------------- */

const answered = new Set<string>();

function remember(messageId: string): boolean {
  if (answered.has(messageId)) return false;
  answered.add(messageId);
  if (answered.size > 400) {
    const oldest = answered.values().next().value;
    if (oldest) answered.delete(oldest);
  }
  return true;
}

// A mention, a reply, or a line in a live conversation. Edits count too, so a later mention still wakes them.
async function onSassyMessage(incoming: Message | PartialMessage): Promise<void> {
  try {
    const message = incoming.partial ? await incoming.fetch() : incoming;
    if (!client.user || message.author.id === client.user.id || !message.inGuild()) return;
    if (message.guildId !== config.guildId) return;
    const fromCrew = message.author.bot && isCrewUser(message.author.id);
    if (message.author.bot && !fromCrew) return;

    const parentId = message.channel.isThread() ? message.channel.parentId : null;
    if (!isChannelAllowed(message.channelId, parentId)) return;

    const roleIds = message.member ? [...message.member.roles.cache.keys()] : [];
    const authorized =
      fromCrew ||
      isAuthorized({
        guildId: message.guildId,
        channelId: message.channelId,
        parentChannelId: parentId,
        userId: message.author.id,
        roleIds,
      });
    const crewHits = crewIdsIn(message.content, message.mentions.users.keys(), message.mentions.repliedUser?.id);
    const addressed =
      crewHits.includes(client.user.id) ||
      messageAddresses(
        message.content,
        client.user.id,
        message.mentions.has(client.user, { ignoreEveryone: true, ignoreRoles: true }),
      );
    if (!fromCrew && authorized) {
      noteHumanMessage(message.channelId, message.id, crewHits, {
        userId: message.author.id,
        name: message.member?.displayName ?? message.author.username,
        roleIds,
      });
    }

    const bare = !fromCrew && hearsInterjection(message.channelId, client.user.id, crewHits);
    if (!addressed && !bare) return;

    const text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    if (!text) return;

    if (!authorized) {
      await message.reply({ content: "Yeah nah, mate. You're not authorized to use me.", allowedMentions: NO_MENTIONS });
      return;
    }

    if (!fromCrew && addressed && /^(reset|forget|clear)$/i.test(text)) {
      if (!remember(message.id)) return;
      clearHistory(message.channelId);
      const channel = message.channel.isSendable() ? message.channel : null;
      if (channel) await channel.send({ content: "Alright. Wiped me memory for this channel. Fresh start.", allowedMentions: NO_MENTIONS });
      return;
    }

    if (!remember(message.id)) return;
    if (fromCrew && !takeCrewTurn(message.channelId)) return;

    const selfId = client.user.id;
    const crewNote = describeCrew(selfId, fromCrew);
    holdFloor(message.channelId, selfId);

    const channel = message.channel.isSendable() ? message.channel : null;
    if (!channel) return;
    if ("sendTyping" in channel) await channel.sendTyping().catch(() => undefined);

    const remembered = fromCrew ? taskHuman(message.channelId) : undefined;
    const requesterId = remembered?.userId ?? message.author.id;
    const requesterName = remembered?.name ?? message.member?.displayName ?? message.author.username;
    const requesterRoles = remembered?.roleIds ?? roleIds;
    const room = await roomTranscript(message);
    const working = await channel.send({ content: "Oi, gimme a sec...", allowedMentions: NO_MENTIONS });
    const reply = createReplyDraft();
    await handleRequest({
      client,
      requesterId,
      requesterName,
      discordControl: canControlDiscord({ userId: requesterId, roleIds: requesterRoles }),
      channelId: message.channelId,
      triggerMessageId: message.id,
      channel,
      guildName: message.guild.name,
      text,
      room,
      fromCrew,
      crewNote,
      responder: messageResponder(working, channel, reply),
      reply,
    });
    holdFloor(message.channelId, selfId);
  } catch (err) {
    console.error("[messageCreate] error:", err);
  }
}

client.on(Events.MessageCreate, (message) => void onSassyMessage(message));
client.on(Events.MessageUpdate, (_prev, message) => void onSassyMessage(message));

// 2) /agent and /agent-reset slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "agent" && interaction.commandName !== "agent-reset") return;

    const member = interaction.member;
    const roleIds = member ? (Array.isArray(member.roles) ? member.roles : [...member.roles.cache.keys()]) : [];
    const parentId = interaction.channel?.isThread() ? interaction.channel.parentId : null;
    if (
      !isAuthorized({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        parentChannelId: parentId,
        userId: interaction.user.id,
        roleIds,
      })
    ) {
      await interaction.reply({
        content: "Yeah nah, mate. You're not authorized to use me here.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "agent-reset") {
      clearHistory(interaction.channelId);
      await interaction.reply({ content: "Alright. Wiped me memory for this channel. Fresh start.", ephemeral: true });
      return;
    }

    const text = interaction.options.getString("request", true);
    await interaction.deferReply();

    const channel = interaction.channel?.isSendable() ? interaction.channel : null;
    const reply = createReplyDraft();
    await handleRequest({
      client,
      requesterId: interaction.user.id,
      requesterName: interaction.user.username,
      discordControl: canControlDiscord({ userId: interaction.user.id, roleIds }),
      channelId: interaction.channelId,
      channel,
      guildName: interaction.guild?.name ?? "the server",
      text,
      fromCrew: false,
      crewNote: client.user ? describeCrew(client.user.id, false) : undefined,
      responder: interactionResponder(interaction, reply),
      reply,
    });
  } catch (err) {
    console.error("[interactionCreate] error:", err);
  }
});

/* -------------------------------------------------------------------------- */
/* Startup                                                                    */
/* -------------------------------------------------------------------------- */

async function registerCommands(): Promise<void> {
  const commands = [
    new SlashCommandBuilder()
      .setName("agent")
      .setDescription("Ask the bot")
      .addStringOption((o) =>
        o.setName("request").setDescription("What should the agent do?").setRequired(true).setMaxLength(2000),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName("agent-reset")
      .setDescription("Clear the agent's conversation memory for this channel")
      .toJSON(),
  ];
  // Guild-scoped commands update instantly and are only visible in the configured server.
  await rest.put(Routes.applicationGuildCommands(config.appId, config.guildId), { body: commands });
}

client.once(Events.ClientReady, async (c) => {
  registerCrewMember({ characterId: "sassy", name: characters.sassy.name, userId: c.user.id });
  console.log(`Logged in as ${c.user.tag}. Model: ${config.model}. ${endpointCount()} Discord operations available.`);
  const guild = await c.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    console.error(
      `The bot is not a member of guild ${config.guildId}. Invite it with the OAuth2 URL first (see README).`,
    );
    process.exit(1);
  }
  try {
    await registerCommands();
    console.log(`Registered /agent and /agent-reset in "${guild.name}".`);
  } catch (err) {
    console.error("Failed to register slash commands (mentions will still work):", err);
  }

  // Feature tools (economy, games, moderation, images) — all reached via the agent.
  try {
    await startFeatures(c);
    const toolCount = features.reduce((n, f) => n + (f.tools?.length ?? 0), 0);
    console.log(`Features ready: ${features.map((f) => f.name).join(", ")} (${toolCount} agent tools).`);
  } catch (err) {
    console.error("Failed to start features (the agent will still work):", err);
  }
});

process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down.`);
  await stopFeatures();
  await stopChatBots();
  await client.destroy();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void startChatBots();
await client.login(config.discordToken);
