import {
  ChatInputCommandInteraction,
  Events,
  Message,
  Routes,
  SlashCommandBuilder,
  type Client,
  type SendableChannels,
} from "discord.js";
import Anthropic from "@anthropic-ai/sdk";
import { runAgent, clearHistory } from "./agent/loop.js";
import { isAuthorized, isChannelAllowed } from "./auth.js";
import { config } from "./config.js";
import { createDiscordClient, createRest } from "./discord.js";
import { features, startFeatures, stopFeatures } from "./features/index.js";
import { audit, requestConfirmation } from "./safety/confirm.js";
import { endpointCount } from "./tools/discordCall.js";
import type { ToolContext } from "./tools/types.js";

const client = createDiscordClient();
const rest = createRest();

const NO_MENTIONS = { parse: [] as never[] };
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

function messageResponder(working: Message, channel: SendableChannels): Responder {
  return {
    update: async (text) => {
      await working.edit({ content: text, allowedMentions: NO_MENTIONS }).catch(() => undefined);
    },
    finish: async (text) => {
      const [first, ...others] = chunk(text);
      await working.edit({ content: first, allowedMentions: NO_MENTIONS }).catch(() => undefined);
      for (const part of others) await channel.send({ content: part, allowedMentions: NO_MENTIONS });
    },
  };
}

function interactionResponder(interaction: ChatInputCommandInteraction): Responder {
  return {
    update: async (text) => {
      await interaction.editReply({ content: text, allowedMentions: NO_MENTIONS }).catch(() => undefined);
    },
    finish: async (text) => {
      const [first, ...others] = chunk(text);
      await interaction.editReply({ content: first, allowedMentions: NO_MENTIONS }).catch(() => undefined);
      for (const part of others) await interaction.followUp({ content: part, allowedMentions: NO_MENTIONS });
    },
  };
}

function friendlyError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "The Anthropic API is rate limiting me right now. Try again in a moment.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `The configured model "${config.model}" was not found. Check ANTHROPIC_MODEL.`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status ?? "unknown"}): ${err.message}`.slice(0, 500);
  }
  return `Something went wrong: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
}

async function handleRequest(params: {
  client: Client;
  requesterId: string;
  requesterName: string;
  channelId: string;
  triggerMessageId?: string;
  channel: SendableChannels | null;
  guildName: string;
  text: string;
  responder: Responder;
}): Promise<void> {
  const { channel } = params;
  const ctx: ToolContext = {
    client: params.client,
    rest,
    guildId: config.guildId,
    requesterId: params.requesterId,
    channelId: params.channelId,
    triggerMessageId: params.triggerMessageId,
    confirm: async (summary) => {
      if (!channel) return false;
      return requestConfirmation(channel, params.requesterId, summary);
    },
  };

  try {
    const result = await runAgent({
      channelKey: params.channelId,
      requesterName: params.requesterName,
      text: params.text,
      guildName: params.guildName,
      botName: params.client.user?.username ?? "Agent",
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

// 1) @mention in a message
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.inGuild() || !client.user) return;
    if (!message.mentions.has(client.user, { ignoreEveryone: true, ignoreRoles: true })) return;

    const text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    if (!text) return;

    const parentId = message.channel.isThread() ? message.channel.parentId : null;
    // Wrong server or a channel the agent is not enabled in: stay silent.
    if (message.guildId !== config.guildId || !isChannelAllowed(message.channelId, parentId)) return;

    const roleIds = message.member ? [...message.member.roles.cache.keys()] : [];
    if (
      !isAuthorized({
        guildId: message.guildId,
        channelId: message.channelId,
        parentChannelId: parentId,
        userId: message.author.id,
        roleIds,
      })
    ) {
      await message.reply({ content: "You are not authorized to use the agent.", allowedMentions: NO_MENTIONS });
      return;
    }

    if (/^(reset|forget|clear)$/i.test(text)) {
      clearHistory(message.channelId);
      await message.reply({ content: "Conversation memory for this channel cleared.", allowedMentions: NO_MENTIONS });
      return;
    }

    const channel = message.channel.isSendable() ? message.channel : null;
    if (!channel) return;
    const working = await message.reply({ content: "Working...", allowedMentions: NO_MENTIONS });

    await handleRequest({
      client,
      requesterId: message.author.id,
      requesterName: message.member?.displayName ?? message.author.username,
      channelId: message.channelId,
      triggerMessageId: message.id,
      channel,
      guildName: message.guild.name,
      text,
      responder: messageResponder(working, channel),
    });
  } catch (err) {
    console.error("[messageCreate] error:", err);
  }
});

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
        content: "You are not authorized to use the agent here.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "agent-reset") {
      clearHistory(interaction.channelId);
      await interaction.reply({ content: "Conversation memory for this channel cleared.", ephemeral: true });
      return;
    }

    const text = interaction.options.getString("request", true);
    await interaction.deferReply();

    const channel = interaction.channel?.isSendable() ? interaction.channel : null;
    await handleRequest({
      client,
      requesterId: interaction.user.id,
      requesterName: interaction.user.username,
      channelId: interaction.channelId,
      channel,
      guildName: interaction.guild?.name ?? "the server",
      text,
      responder: interactionResponder(interaction),
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
      .setDescription("Ask the AI agent to manage the server")
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
  await client.destroy();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.discordToken);
