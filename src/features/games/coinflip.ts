import { randomInt } from "node:crypto";
import type { User } from "discord.js";
import { economy, formatCoins, touch } from "../economy/instance.js";
import { UserError } from "../types.js";
import { parseBet } from "./bet.js";

const SIDES: Record<string, "heads" | "tails"> = { h: "heads", heads: "heads", t: "tails", tails: "tails" };

export interface CoinflipResult {
  call: "heads" | "tails";
  result: "heads" | "tails";
  won: boolean;
  bet: number;
  balance: number;
  /** Ready-to-post Discord message with the outcome. */
  message: string;
}

/**
 * Flip a coin for `user`. Throws UserError for bad bets / side. The agent must post `message` as-is;
 * the flip is decided here, not by the model.
 */
export async function runCoinflip(params: {
  user: User;
  betArg: string | undefined;
  sideArg?: string;
}): Promise<CoinflipResult> {
  const { user } = params;
  const { balance } = touch(user);
  const bet = parseBet(params.betArg, balance);
  if (!bet.ok) throw new UserError(bet.error);

  const sideArg = params.sideArg?.toLowerCase();
  const call = sideArg ? SIDES[sideArg] : "heads";
  if (!call) throw new UserError("Pick `heads` or `tails` (or leave it out).");

  const holdId = economy.hold(user.id, bet.amount);
  if (!holdId) throw new UserError(`You only have ${formatCoins(economy.getBalance(user.id))} coins.`);

  const result = randomInt(2) === 0 ? "heads" : "tails";
  const won = result === call;
  const { balance: newBalance } = economy.settle(holdId, won ? bet.amount * 2 : 0);

  const message = won
    ? `🪙 **${result}!** You called ${call} and won **${formatCoins(bet.amount)}** coins. Balance: ${formatCoins(newBalance)}`
    : `🪙 **${result}.** You called ${call} and lost **${formatCoins(bet.amount)}** coins. Balance: ${formatCoins(newBalance)}`;

  return { call, result, won, bet: bet.amount, balance: newBalance, message };
}
