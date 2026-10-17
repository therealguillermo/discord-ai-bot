import { Events, type Client, type Message, type PartialMessage, type SendableChannels } from "discord.js";
import { acknowledgement } from "../agent/ack.js";
import { characters, type CharacterId } from "../agent/characters/index.js";
import { failureText, MISSING_REPLY, replyToMessage } from "../agent/failure.js";
import { clearHistory, runAgent } from "../agent/loop.js";
import { canControlDiscord, isAuthorized, isChannelAllowed } from "../auth.js";
import { config } from "../config.js";
import { createDiscordClient, createRest } from "../discord.js";
import { musicFeature } from "../features/music/index.js";
import { requestConfirmation } from "../safety/confirm.js";
import type { REST } from "@discordjs/rest";
import type { ReplyDraft } from "../tools/types.js";
import { takeCrewTurn } from "./chain.js";
import { whenClientReady } from "./ready.js";
import {
  crewIdsIn,
  crewMentions,
  describeCrew,
  isCrewUser,
  messageAddresses,
  registerCrewMember,
} from "./roster.js";
import { hearsInterjection, holdFloor, noteHumanMessage, roomTranscript, taskHuman } from "./room.js";

const rests = new Map<CharacterId, REST>();
const running: Client[] = [];
const answered = new Set<string>();
const USER_MENTIONS = { parse: ["users"] as ("users")[] };
const NO_MENTIONS = { parse: [] as never[] };

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

async function say(channel: SendableChannels, text: string): Promise<void> {
  const parts: string[] = [];
  let remaining = text.trim() || MISSING_REPLY;
  while (remaining.length > 1900) {
    let cut = remaining.lastIndexOf("\n", 1900);
    if (cut < 900) cut = 1900;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  parts.push(remaining);
  const [first, ...rest] = parts;
  if (!first) return;
  let sent = false;
  try {
    await channel.send({ content: first, allowedMentions: USER_MENTIONS });
    sent = true;
    for (const part of rest) await channel.send({ content: part, allowedMentions: USER_MENTIONS });
  } catch (err) {
    console.error("[crew] send failed:", err);
    if (sent) return;
    await channel.send({ content: failureText(err).slice(0, 1900), allowedMentions: NO_MENTIONS });
  }
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

  let channel: SendableChannels | null = null;
  let accepted = false;
  try {
    if (!client.user || message.author.id === client.user.id) return;
    if (!message.inGuild() || message.guildId !== config.guildId) return;
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

    if (!authorized) {
      if (addressed && message.channel.isSendable()) {
        await replyToMessage(message, message.channel, "You're not authorized to use me here.");
      }
      return;
    }

    const text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    const channelKey = `${characterId}:${message.channelId}`;
    if (!fromCrew && addressed && /^(reset|forget|clear)$/i.test(text)) {
      if (!remember(`${characterId}:${message.id}`)) return;
      clearHistory(channelKey);
      if (message.channel.isSendable()) await replyToMessage(message, message.channel, "Started over.");
      return;
    }
    if (!text && !addressed) return;
    if (!remember(`${characterId}:${message.id}`)) return;

    if (fromCrew && !takeCrewTurn(message.channelId)) return;

    const selfId = client.user.id;
    const botName = client.user.username;
    holdFloor(message.channelId, selfId);

    const live = message.channel.isSendable() ? message.channel : null;
    channel = live;
    if (!live) return;
    accepted = true;
    if ("sendTyping" in live) await live.sendTyping().catch(() => undefined);

    const remembered = fromCrew ? taskHuman(message.channelId) : undefined;
    const behind = fromCrew && !remembered ? await humanBehind(message) : message;
    const requesterId = remembered?.userId ?? behind.author.id;
    const requesterName = remembered?.name ?? behind.member?.displayName ?? behind.author.username;
    const requesterRoles = remembered?.roleIds ?? (behind.member ? [...behind.member.roles.cache.keys()] : []);
    const room = await roomTranscript(message);
    const character = characters[characterId];
    const requestText = text || "They mentioned you and didn't say anything else.";
    const ack = fromCrew
      ? null
      : acknowledgement(characterId, requestText, `${message.channelId}\n${requestText}`);
    if (ack) {
      try {
        await say(live, ack);
      } catch (err) {
        console.error(`[crew] ${characterId} ack failed:`, err);
      }
    }
    const result = await runAgent({
      channelKey,
      requesterName,
      text: requestText,
      alreadyAcked: Boolean(ack),
      room,
      guildName: message.guild.name,
      botName,
      character: characterId,
      fromCrew,
      crew: crewMentions(selfId),
      crewNote: describeCrew(selfId, fromCrew),
      ctx: {
        client,
        rest: rests.get(characterId) ?? createRest(),
        guildId: config.guildId,
        requesterId,
        discordControl: canControlDiscord({ userId: requesterId, roleIds: requesterRoles }),
        channelId: message.channelId,
        triggerMessageId: message.id,
        confirm: (summary) => requestConfirmation(live, requesterId, summary),
        reply: emptyReply(),
      },
    });
    console.log(
      `[crew] ${character.name} <- ${message.author.username}: ${result.iterations} iteration(s), ` +
        `${result.inputTokens} in / ${result.outputTokens} out tokens`,
    );
    await say(live, result.text.trim() || MISSING_REPLY);
    holdFloor(message.channelId, selfId);
  } catch (err) {
    console.error(`[crew] ${characterId} failed:`, err instanceof Error ? err.message : err);
    if (accepted && channel) await replyToMessage(message, channel, failureText(err));
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
      // Donny: chat. Clarence: voice only. Mike: same privileged set as Sassy when the portal allows it.
      const kind = id === "donny" ? "chat" : id === "clarence" ? "music" : "operator";
      const attempts = [
        {},
        { messageContent: false },
        { messageContent: false, guildMembers: false },
      ] as const;
      let client = createDiscordClient(kind, attempts[0]);
      attach(client);
      running.push(client);
      rests.set(id, createRest(token));
      try {
        let loggedIn = false;
        let lastDetail = "";
        for (let i = 0; i < attempts.length; i++) {
          try {
            if (i > 0) {
              const at = running.indexOf(client);
              if (at >= 0) running.splice(at, 1);
              await client.destroy();
              client = createDiscordClient(kind, attempts[i]);
              attach(client);
              running.push(client);
            }
            await client.login(token);
            loggedIn = true;
            if (i === 1) {
              console.error(
                `[crew] ${character.name}: Message Content intent is off in the portal. Mentions still work.`,
              );
            } else if (i === 2) {
              console.error(
                `[crew] ${character.name}: Server Members intent is off in the portal. Online with reduced intents.`,
              );
            }
            break;
          } catch (err) {
            lastDetail = err instanceof Error ? err.message : String(err);
            if (!/disallowed intent/i.test(lastDetail)) throw err;
          }
        }
        if (!loggedIn) throw new Error(lastDetail || "Used disallowed intents");
        if (!client.user) throw new Error("login finished without a user");
        registerCrewMember({
          characterId: id,
          name: id === "mike" ? "Nolzy" : character.name,
          userId: client.user.id,
        });
        const guild = await client.guilds.fetch(config.guildId).catch(() => null);
        if (id === "clarence") {
          try {
            const ready = await whenClientReady(client);
            await musicFeature.start?.(ready);
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
