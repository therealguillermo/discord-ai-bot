import type { CharacterId } from "../agent/characters/index.js";
import type { CrewMention } from "../agent/prompt.js";

export interface CrewMember {
  characterId: CharacterId;
  name: string;
  userId: string;
}

const members = new Map<string, CrewMember>();

export function registerCrewMember(member: CrewMember): void {
  members.set(member.userId, member);
}

export function isCrewUser(userId: string): boolean {
  return members.has(userId);
}

export function crewMentions(exceptUserId?: string): CrewMention[] {
  return [...members.values()]
    .filter((member) => member.userId !== exceptUserId)
    .map((member) => ({ name: member.name, mention: `<@${member.userId}>` }));
}

/** Trusted note for the request header. Undefined when nobody else is online. */
export function describeCrew(selfUserId: string, fromCrew: boolean): string | undefined {
  const others = crewMentions(selfUserId);
  if (!others.length) return undefined;
  const list = others.map((member) => `${member.name} ${member.mention}`).join(", ");
  const hint = fromCrew
    ? "Answer this crew bot in character. If the conversation should continue, @mention exactly one other bot from this list."
    : "If they asked you to talk with these bots, @mention exactly one of them. Otherwise do not mention them.";
  return `Other bots online: ${list}. ${hint}`;
}

export function messageAddresses(content: string, userId: string, mentionsHas: boolean): boolean {
  if (mentionsHas) return true;
  return new RegExp(`<@!?${userId}>`).test(content);
}
