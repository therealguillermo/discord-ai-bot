import { randomInt } from "node:crypto";
import { economy, formatCoins, touch } from "../economy/instance.js";
import { UserError, type PrefixCommand } from "../types.js";
import { parseBet } from "./bet.js";

const SIDES: Record<string, "heads" | "tails"> = { h: "heads", heads: "heads", t: "tails", tails: "tails" };

export const coinflip: PrefixCommand = {
  name: "cf",
  aliases: ["coinflip", "flip"],
  usage: "<bet|half|all> [heads|tails]",
  description: "Flip a coin for double or nothing.",
  execute: async (ctx) => {
    const { balance } = touch(ctx.message.author);
    const bet = parseBet(ctx.args[0], balance);
    if (!bet.ok) throw new UserError(bet.error);

    const sideArg = ctx.args[1]?.toLowerCase();
    const call = sideArg ? SIDES[sideArg] : "heads";
    if (!call) throw new UserError("Pick `heads` or `tails` (or leave it out).");

    const holdId = economy.hold(ctx.message.author.id, bet.amount);
    if (!holdId) throw new UserError(`You only have ${formatCoins(economy.getBalance(ctx.message.author.id))} coins.`);

    const result = randomInt(2) === 0 ? "heads" : "tails";
    const won = result === call;
    const { balance: newBalance } = economy.settle(holdId, won ? bet.amount * 2 : 0);

    await ctx.reply(
      won
        ? `🪙 **${result}!** You called ${call} and won **${formatCoins(bet.amount)}** coins. Balance: ${formatCoins(newBalance)}`
        : `🪙 **${result}.** You called ${call} and lost **${formatCoins(bet.amount)}** coins. Balance: ${formatCoins(newBalance)}`,
    );
  },
};
