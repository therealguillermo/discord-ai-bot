import path from "node:path";
import type { User } from "discord.js";
import { config } from "../../config.js";
import { EconomyStore } from "./store.js";

/** The one shared economy for the configured server. */
export const economy = new EconomyStore({
  filePath: path.resolve(process.cwd(), config.dataDir, "economy.json"),
  startingBalance: config.startingBalance,
});

/** Keys the old bot used for this user (it filed balances under str(author), i.e. the username). */
function legacyNames(user: User): string[] {
  const names = [user.username];
  if (user.discriminator && user.discriminator !== "0") names.push(`${user.username}#${user.discriminator}`);
  return names;
}

/**
 * Make sure the user has an account and pull in any balance from the old bot.
 * Safe to call on every command.
 */
export function touch(user: User): { balance: number; created: boolean; claimed: number } {
  const created = economy.ensure(user.id);
  const claimed = economy.claimLegacy(user.id, legacyNames(user));
  return { balance: economy.getBalance(user.id), created, claimed };
}

export const formatCoins = (n: number) => n.toLocaleString("en-US");
