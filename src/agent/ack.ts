import type { CharacterId } from "./characters/index.js";

const LINES: Record<CharacterId, readonly string[]> = {
  sassy: ["Coming right up, mate.", "Yeah, on it.", "Give us a sec."],
  clarence: ["Um, coming right up.", "Oh, ok. On it.", "Right, um, one sec."],
  donny: ["Yeah, on it.", "Give us a sec.", "Coming right up."],
  mike: ["Yeah, on it.", "Give us a tick.", "Righto."],
};

/** A status check, not a request to start something. */
const QUEUE_CHECK =
  /\b(?:what(?:'s| is) (?:playing|on|the queue)|now playing|show (?:the )?queue|queue list)\b/i;

/** Games and lookups that already return in one quick tool call. */
const QUICK = /\b(?:blackjack|coinflip|coin flip|balance|leaderboard)\b/i;

const SLOW =
  /\b(?:play|queue|put on|join(?: the)? (?:vc|voice)|hop in|come to (?:vc|voice)|leetify|faceit|steam|csst|cs2|counter[- ]strike|premier|dossier|lookup|look up|draw|generate|paint)\b|(?:youtu\.be|youtube\.com|spotify\.com|soundcloud\.com)|\b(?:image|picture|pic) of\b/i;

export function isSlowRequest(text: string): boolean {
  const line = text.trim();
  if (!line || QUICK.test(line)) return false;
  if (QUEUE_CHECK.test(line) && !/\bplay\b|youtu\.?be|youtube\.com/i.test(line)) return false;
  return SLOW.test(line);
}

/** A one-line heads-up for a slow job. Null when the reply itself will be quick. */
export function acknowledgement(character: CharacterId, text: string, seed = text): string | null {
  if (!isSlowRequest(text)) return null;
  const lines = LINES[character];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return lines[hash % lines.length]!;
}
