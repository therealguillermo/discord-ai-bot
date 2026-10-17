/** How many bot-to-bot replies can follow one person before the chain stops. */
export const CREW_CHAIN_CAP = 6;

const turns = new Map<string, number>();

/** A person spoke. The next bot-to-bot chain starts over. */
export function resetCrewChain(channelId: string): void {
  turns.set(channelId, 0);
}

/**
 * One bot is about to answer another bot.
 * False once this channel has already used its cap.
 */
export function takeCrewTurn(channelId: string, cap = CREW_CHAIN_CAP): boolean {
  const used = turns.get(channelId) ?? 0;
  if (used >= cap) return false;
  turns.set(channelId, used + 1);
  return true;
}
