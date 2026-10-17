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
    ? "They spoke in this same channel conversation. Answer in character so everyone in the chat can follow. To keep the banter going, @mention exactly one other bot from this list. If someone else is typing or talking, finish your line anyway."
    : "Answer into the channel as one conversation with the people and these bots. If they asked you to talk with these bots, @mention exactly one of them. A person who interjects is part of this chat. Finish your message even if someone pings another bot while you are typing. Otherwise do not mention these bots.";
  return `Other bots online: ${list}. ${hint}`;
}

/** Crew bots named by mentions in the text, the mention list, or a reply to one of them. */
export function crewIdsIn(content: string, mentionedUserIds: Iterable<string>, repliedUserId?: string | null): string[] {
  const mentioned = new Set(mentionedUserIds);
  const hits: string[] = [];
  for (const member of members.values()) {
    if (mentioned.has(member.userId) || new RegExp(`<@!?${member.userId}>`).test(content)) hits.push(member.userId);
  }
  if (repliedUserId && members.has(repliedUserId) && !hits.includes(repliedUserId)) hits.push(repliedUserId);
  return hits;
}

export function messageAddresses(content: string, userId: string, mentionsHas: boolean): boolean {
  if (mentionsHas) return true;
  return new RegExp(`<@!?${userId}>`).test(content);
}
