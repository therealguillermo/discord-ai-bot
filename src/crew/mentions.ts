import type { CrewMention } from "../agent/prompt.js";

/**
 * The mention is the name. Models keep writing "G'day Sassy ... <@id>".
 * Fold the spoken name into the mention and drop the extra ping on the end.
 */
export const MENTION_IN_PLACE =
  "When you name another bot, that name is their mention. Write their <@id> in the sentence where the name would have been. Do not say Sassy, Clarence, Donny, or Nolzy and then paste the mention on the end. Failed shape: \"G'day Sassy. Um, hi. <@id>\". Right shape: \"G'day <@id>. Um, hi.\" Failed shape: \"Nolzy, your turn. <@id>\". Right shape: \"<@id>, your turn.\" Never mention yourself.";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Spoken names for one crew bot, longest first so "Sassy the Sasquatch" wins over "Sassy". */
export function spokenNames(name: string): string[] {
  const names = new Set<string>([name, name.replace(/\s+/g, "")]);
  const first = name.split(/\s+/)[0];
  if (first && first.length > 2 && !/^mike$/i.test(first)) names.add(first);
  if (/^mike nolan$/i.test(name)) names.add("Nolzy");
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length);
}

function mentionToken(mention: string): string | undefined {
  const match = mention.match(/^<@!?(\d{15,25})>$/);
  return match ? `<@${match[1]}>` : undefined;
}

function dropTrailingDuplicate(text: string, mention: string): string {
  const token = escapeRegExp(mention);
  const count = () => text.match(new RegExp(token, "g"))?.length ?? 0;
  while (count() > 1 && new RegExp(`${token}\\s*$`).test(text)) {
    text = text.replace(new RegExp(`\\s*${token}\\s*$`), "").trimEnd();
  }
  return text;
}

/** Replace other bots' spoken names with their mention, then drop a repeated ping on the end. */
export function inlineCrewMentions(text: string, crew: CrewMention[]): string {
  if (!text.trim() || crew.length === 0) return text;
  let out = text.replace(/<@!?(\d{15,25})>/g, "<@$1>");
  for (const member of crew) {
    const mention = mentionToken(member.mention);
    if (!mention) continue;
    for (const alias of spokenNames(member.name)) {
      const re = new RegExp(`(?<![\\w@])${escapeRegExp(alias)}(?![\\w])`, "gi");
      out = out.replace(re, mention);
    }
    out = dropTrailingDuplicate(out, mention);
  }
  return out.replace(/[ \t]{2,}/g, " ").trim();
}
