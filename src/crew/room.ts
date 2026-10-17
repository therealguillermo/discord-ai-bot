import type { Message } from "discord.js";
import { resetCrewChain } from "./chain.js";
import { withoutCrewPings } from "./roster.js";

/** How long a channel stays one live conversation after a bot takes the floor. */
export const ROOM_ACTIVE_MS = 3 * 60 * 1000;

interface Room {
  /** Created-at time of the newest human message that joined this channel. */
  humanCutAt: number;
  /** Crew user ids the newest human message spoke to, if any. */
  latestHumanMentions: string[];
  /** Discord user id of the bot currently carrying the conversation. */
  lastSpeakerId?: string;
  activeUntil: number;
  tail: Promise<unknown>;
}

const rooms = new Map<string, Room>();
const notedHumans = new Set<string>();

function roomFor(channelId: string): Room {
  let room = rooms.get(channelId);
  if (!room) {
    room = { humanCutAt: 0, latestHumanMentions: [], activeUntil: 0, tail: Promise.resolve() };
    rooms.set(channelId, room);
  }
  return room;
}

function rememberHuman(messageId: string): boolean {
  if (notedHumans.has(messageId)) return false;
  notedHumans.add(messageId);
  if (notedHumans.size > 400) {
    const oldest = notedHumans.values().next().value;
    if (oldest) notedHumans.delete(oldest);
  }
  return true;
}

/**
 * A person spoke in the channel. Later bot-to-bot turns from before this
 * message are part of the old side of the conversation and should yield.
 * The chain budget starts over so banter can continue from here.
 */
export function noteHumanMessage(
  channelId: string,
  createdTimestamp: number,
  messageId: string,
  mentionedCrewIds: string[],
): void {
  if (!rememberHuman(messageId)) return;
  const room = roomFor(channelId);
  if (createdTimestamp >= room.humanCutAt) {
    room.humanCutAt = createdTimestamp;
    room.latestHumanMentions = mentionedCrewIds;
  }
  resetCrewChain(channelId);
}

/** True when a person has spoken since this trigger message was created. */
export function isSuperseded(channelId: string, triggerAt: number): boolean {
  return roomFor(channelId).humanCutAt > triggerAt;
}

/**
 * Unsent banter yields to the newer human message.
 * A task that already ran still gets said, without a ping that would start a second chain.
 */
export function settleReply(channelId: string, triggerAt: number, usedTools: boolean, text: string): string | null {
  if (!isSuperseded(channelId, triggerAt)) return text;
  if (!usedTools) return null;
  return withoutCrewPings(text);
}

/** This bot picks up a human line that did not name anyone, while the conversation is live. */
export function hearsInterjection(channelId: string, selfId: string, mentionedCrewIds: string[]): boolean {
  if (mentionedCrewIds.length > 0) return false;
  const room = rooms.get(channelId);
  if (!room || room.activeUntil <= Date.now()) return false;
  return room.lastSpeakerId === selfId;
}

/** Take the floor so the next bare interjection comes to this bot, not a second conversation. */
export function holdFloor(channelId: string, userId: string): void {
  const room = roomFor(channelId);
  room.lastSpeakerId = userId;
  room.activeUntil = Date.now() + ROOM_ACTIVE_MS;
}

/** One speaker at a time per channel. A ping and an interjection queue into the same chat. */
export function enqueueRoom<T>(channelId: string, work: () => Promise<T>): Promise<T> {
  const room = roomFor(channelId);
  const run = room.tail.catch(() => undefined).then(work);
  room.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface RoomLine {
  id: string;
  createdTimestamp: number;
  authorName: string;
  content: string;
}

/** Oldest first, skipping the message being answered and empty lines. */
export function formatRoom(lines: RoomLine[], skipId?: string): string {
  return lines
    .filter((line) => line.id !== skipId && line.content.trim())
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-12)
    .map((line) => `${line.authorName}: ${line.content.replace(/\s+/g, " ").trim().slice(0, 240)}`)
    .join("\n");
}

export async function roomTranscript(message: Message): Promise<string> {
  const channel = message.channel;
  if (!channel.isTextBased() || channel.isDMBased()) return "";
  const fetched = await channel.messages.fetch({ limit: 16 }).catch(() => null);
  if (!fetched) return "";
  return formatRoom(
    [...fetched.values()].map((entry) => ({
      id: entry.id,
      createdTimestamp: entry.createdTimestamp,
      authorName: entry.member?.displayName ?? entry.author.username,
      content: entry.content,
    })),
    message.id,
  );
}
