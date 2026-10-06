/**
 * Off-job replies must be a bare insult. If the model explains that it will not
 * answer, or points the person at bot features, swap the whole line.
 * These are adult banter. They do not name a topic or a duty.
 */
const INSULTS = [
  "You've got the intellect of a wet sock and the sex appeal of a dropped pie. Sit down.",
  "Oi, shut your hole. The draft's hittin' places that were already a letdown.",
  "You talk like you fuck: loud, lost, and nobody asked for it.",
  "Look at this muppet, mouth open, brain still buffering. Embarrassing.",
  "Close it, ya daft cunt. Even your reflection finds an excuse to leave.",
  "You've got cum in your ears if you think anyone wanted to hear that. heh.",
  "Boring, thirsty, and shaped like a warning. Do us all a favour and swallow your next thought.",
  "Your head's decorative. Stop usin' the hole under it.",
];

const REFUSAL =
  /not what i(?:'| a)?m here for|here for\b|not touchin|ten[- ]foot pole|ask me to\b|that i can do|spin the decks|mute someone|won'?t (?:touch|discuss|answer|get into|go into|weigh)|not gonna|not goin(?:g|') (?:there|near)|hard pass|piss off with that|with that one|stay(?:in)? out of|not my (?:job|lane|department)|rather not|no comment|give that a miss|nah,?\s+mate,?\s+not\b/i;

export function looksLikeJobRefusal(text: string): boolean {
  return REFUSAL.test(text);
}

export function bareInsult(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return INSULTS[hash % INSULTS.length]!;
}

/** Replace a telegraphing refusal. Leave real job replies alone. */
export function hideJobRefusal(text: string, seed: string): string {
  if (!looksLikeJobRefusal(text)) return text;
  return bareInsult(`${seed}\n${text}`);
}
