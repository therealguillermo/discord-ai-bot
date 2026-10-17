import type { Message } from "discord.js";
import { resetCrewChain } from "./chain.js";

/** How long a channel stays one live conversation after a bot takes the floor. */
export const ROOM_ACTIVE_MS = 3 * 60 * 1000;

export interface FloorHuman {
  userId: string;
  name: string;
  roleIds: string[];
}

interface Room {
  /** Person whose request the tools should run as. A bare interjection does not replace them. */
  taskHuman?: FloorHuman;
  /** Discord user id of the bot currently carrying the conversation. */
  lastSpeakerId?: string;
  activeUntil: number;
}

const rooms = new Map<string, Room>();
const notedHumans = new Set<string>();

function roomFor(channelId: string): Room {
  let room = rooms.get(channelId);
  if (!room) {
    room = { activeUntil: 0 };
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
 * A person spoke in the channel. The chain budget starts over so banter
 * can continue, and the task human is updated when they name a bot.
 */
export function noteHumanMessage(
  channelId: string,
  messageId: string,
  mentionedCrewIds: string[],
  human?: FloorHuman,
): void {
  if (!rememberHuman(messageId)) return;
  const room = roomFor(channelId);
  if (human && (mentionedCrewIds.length > 0 || !room.taskHuman)) room.taskHuman = human;
  resetCrewChain(channelId);
}

/** Human a crew turn should act for. Undefined until someone in the channel has spoken. */
export function taskHuman(channelId: string): FloorHuman | undefined {
  return rooms.get(channelId)?.taskHuman;
}

/** This bot picks up a human line that did not name anyone, while the conversation is live. */
export function hearsInterjection(channelId: string, selfId: string, mentionedCrewIds: string[]): boolean {
  if (mentionedCrewIds.length > 0) return false;
  const room = rooms.get(channelId);
  if (!room || room.activeUntil <= Date.now()) return false;
  return room.lastSpeakerId === selfId;
}

/** Take the floor so the next bare interjection comes to this bot. */
export function holdFloor(channelId: string, userId: string): void {
  const room = roomFor(channelId);
  room.lastSpeakerId = userId;
  room.activeUntil = Date.now() + ROOM_ACTIVE_MS;
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
