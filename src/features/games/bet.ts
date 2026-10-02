export type BetResult = { ok: true; amount: number } | { ok: false; error: string };

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Parse a bet like "50", "all" or "half" against the player's balance.
 * Only positive whole numbers are accepted, so negative, fractional, NaN and Infinity bets
 * (the old bot's coin exploits) are rejected here.
 */
export function parseBet(input: string | undefined, balance: number): BetResult {
  if (!input) return { ok: false, error: "Tell me how many coins to bet, e.g. `50`, `half` or `all`." };
  const text = input.trim().toLowerCase();

  if (balance <= 0) return { ok: false, error: "You have no coins to bet. Hang out in voice chat to earn some." };

  let amount: number;
  if (text === "all" || text === "allin") {
    amount = balance;
  } else if (text === "half") {
    amount = Math.floor(balance / 2);
    if (amount < 1) amount = 1;
  } else if (/^\d{1,15}$/.test(text)) {
    amount = Number(text);
  } else {
    return { ok: false, error: `"${input.slice(0, 30)}" isn't a valid bet. Use a whole number, \`half\` or \`all\`.` };
  }

  if (amount < 1) return { ok: false, error: "The minimum bet is 1 coin." };
  if (amount > balance) return { ok: false, error: `You only have ${fmt(balance)} coins.` };
  return { ok: true, amount };
}
