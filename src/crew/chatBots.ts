import { Events, type Client, type Message, type PartialMessage, type SendableChannels } from "discord.js";
import { characters, type CharacterId } from "../agent/characters/index.js";
import { clearHistory, runAgent } from "../agent/loop.js";
import { canControlDiscord, isAuthorized, isChannelAllowed } from "../auth.js";
import { config } from "../config.js";
import { createDiscordClient, createRest } from "../discord.js";
import { musicFeature } from "../features/music/index.js";
import { requestConfirmation } from "../safety/confirm.js";
import type { REST } from "@discordjs/rest";
import type { ReplyDraft } from "../tools/types.js";
import { resetCrewChain, takeCrewTurn } from "./chain.js";
import { crewMentions, describeCrew, isCrewUser, messageAddresses, registerCrewMember } from "./roster.js";

const rests = new Map<CharacterId, REST>();
const running: Client[] = [];
const answered = new Set<string>();
const USER_MENTIONS = { parse: ["users"] as ("users")[] };

const CHAT_IDS = ["donny", "clarence", "mike"] as const;

function remember(key: string): boolean {
  if (answered.has(key)) return false;
  answered.add(key);
  if (answered.size > 400) {
    const oldest = answered.values().next().value;
    if (oldest) answered.delete(oldest);
  }
  return true;
}

function emptyReply(): ReplyDraft {
  return {
    embeds: [],
    stickerIds: [],
    set(next) {
      this.content = next.content;
      this.embeds = next.embeds;
    },
  };
}

async function say(channel: SendableChannels, text: string, replyTo?: Message): Promise<void> {
  const parts: string[] = [];
  let remaining = text.trim() || "...";
  while (remaining.length > 1900) {
    let cut = remaining.lastIndexOf("\n", 1900);
    if (cut < 900) cut = 1900;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  parts.push(remaining);
  const [first, ...rest] = parts;
  if (!first) return;
  if (replyTo) {
    try {
      await replyTo.reply({ content: first, allowedMentions: USER_MENTIONS });
    } catch {
      await channel.send({ content: first, allowedMentions: USER_MENTIONS });
    }
  } else {
    await channel.send({ content: first, allowedMentions: USER_MENTIONS });
  }
  for (const part of rest) await channel.send({ content: part, allowedMentions: USER_MENTIONS });
}

async function humanBehind(message: Message): Promise<Message> {
  let current = message;
  for (let i = 0; i < 6; i++) {
    if (!isCrewUser(current.author.id)) return current;
    const refId = current.reference?.messageId;
    if (!refId || !current.channel.isTextBased()) return current;
    const parent = await current.channel.messages.fetch(refId).catch(() => null);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

async function onChatMessage(
  incoming: Message | PartialMessage,
  characterId: CharacterId,
  client: Client,
): Promise<void> {
  let message: Message;
  try {
    message = incoming.partial ? await incoming.fetch() : incoming;
  } catch {
    return;
  }

  try {
    if (!client.user || message.author.id === client.user.id) return;
    if (!message.inGuild() || message.guildId !== config.guildId) return;
    const fromCrew = message.author.bot && isCrewUser(message.author.id);
    if (message.author.bot && !fromCrew) return;
    if (
      !messageAddresses(
        message.content,
        client.user.id,
        message.mentions.has(client.user, { ignoreEveryone: true, ignoreRoles: true }),
      )
    ) {
      return;
    }

    const parentId = message.channel.isThread() ? message.channel.parentId : null;
    if (!isChannelAllowed(message.channelId, parentId)) return;
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
      return;
    }

    const text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const channelKey = `${characterId}:${message.channelId}`;
    if (!fromCrew && /^(reset|forget|clear)$/i.test(text)) {
      if (!remember(`${characterId}:${message.id}`)) return;
      clearHistory(channelKey);
      if (message.channel.isSendable()) await say(message.channel, "Started over.", message);
      return;
    }

    if (!remember(`${characterId}:${message.id}`)) return;
    if (fromCrew) {
      if (!takeCrewTurn(message.channelId)) return;
    } else {
      resetCrewChain(message.channelId);
    }

    const channel = message.channel.isSendable() ? message.channel : null;
    if (!channel) return;
    if ("sendTyping" in channel) await channel.sendTyping().catch(() => undefined);

    const human = await humanBehind(message);
    const humanRoles = human.member ? [...human.member.roles.cache.keys()] : [];
    const character = characters[characterId];
    const result = await runAgent({
      channelKey,
      requesterName: human.member?.displayName ?? human.author.username,
      text: text || "They mentioned you and didn't say anything else.",
      guildName: message.guild.name,
      botName: client.user.username,
      character: characterId,
      fromCrew,
      crew: crewMentions(client.user.id),
      crewNote: describeCrew(client.user.id, fromCrew),
      ctx: {
        client,
        rest: rests.get(characterId) ?? createRest(),
        guildId: config.guildId,
        requesterId: human.author.id,
        discordControl: canControlDiscord({ userId: human.author.id, roleIds: humanRoles }),
        channelId: message.channelId,
        triggerMessageId: message.id,
        confirm: (summary) => requestConfirmation(channel, human.author.id, summary),
        reply: emptyReply(),
      },
    });
    console.log(
      `[crew] ${character.name} <- ${message.author.username}: ${result.iterations} iteration(s), ` +
        `${result.inputTokens} in / ${result.outputTokens} out tokens`,
    );
    await say(channel, result.text, message);
  } catch (err) {
    console.error(`[crew] ${characterId} failed:`, err instanceof Error ? err.message : err);
  }
}

export async function startChatBots(): Promise<void> {
  await Promise.all(
    CHAT_IDS.map(async (id) => {
      const character = characters[id];
      const token = config.characterTokens[id];
      if (!token) {
        console.log(`[crew] ${character.name} has no token set. Skipping.`);
        return;
      }
      if (token === config.discordToken) {
        console.error(`[crew] ${character.name} is using Sassy's token. Give that bot its own token.`);
        return;
      }
      const attach = (bot: Client) => {
        bot.on(Events.MessageCreate, (message) => void onChatMessage(message, id, bot));
        bot.on(Events.MessageUpdate, (_prev, message) => void onChatMessage(message, id, bot));
      };
      const kind = id === "donny" ? "chat" : "operator";
      let client = createDiscordClient(kind);
      attach(client);
      running.push(client);
      rests.set(id, createRest(token));
      try {
        try {
          await client.login(token);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          if (!/disallowed intent/i.test(detail)) throw err;
          console.error(
            `[crew] ${character.name} is missing the Message Content intent. Logging in without it. Mentions still work.`,
          );
          const at = running.indexOf(client);
          if (at >= 0) running.splice(at, 1);
          await client.destroy();
          client = createDiscordClient(kind, false);
          attach(client);
          running.push(client);
          await client.login(token);
        }
        if (!client.user) throw new Error("login finished without a user");
        registerCrewMember({
          characterId: id,
          name: id === "mike" ? "Nolzy" : character.name,
          userId: client.user.id,
        });
        const guild = await client.guilds.fetch(config.guildId).catch(() => null);
        if (id === "clarence" && client.isReady()) {
          try {
            await musicFeature.start?.(client);
          } catch (err) {
            console.error("[crew] Clarence's music player failed to start:", err instanceof Error ? err.message : err);
          }
        }
        const duty = id === "clarence" ? "music" : id === "mike" ? "discord" : "steam/cs";
        if (!guild) {
          console.error(`[crew] ${character.name} is not in this server. Invite that bot, then restart.`);
        } else {
          console.log(`[crew] ${character.name} online as ${client.user.tag} in "${guild.name}" (${duty}).`);
        }
      } catch (err) {
        console.error(`[crew] ${character.name} failed to log in:`, err instanceof Error ? err.message : err);
        const index = running.indexOf(client);
        if (index >= 0) running.splice(index, 1);
        await client.destroy();
      }
    }),
  );
}

export async function stopChatBots(): Promise<void> {
  await Promise.all(running.splice(0).map((client) => client.destroy()));
}
