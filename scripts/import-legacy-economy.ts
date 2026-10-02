/**
 * One-time import of the old GearmyBot balances (gamblingModules/econ.json).
 *
 *   npm run import:legacy -- "C:\path\to\DiscordBot-GearmyBot-\gamblingModules\econ.json"
 *
 * The old bot filed balances under the user's username. They are stored as "unclaimed" and each
 * person receives theirs automatically the first time they use a coin command (matched on their
 * current Discord username). Run this while the bot is stopped, then start it.
 * Nothing is printed except counts.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { EconomyStore } from "../src/features/economy/store.js";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run import:legacy -- <path to old econ.json>");
  process.exit(1);
}

const dataDir = process.env.DATA_DIR?.trim() || "data";
const startingBalance = Number(process.env.ECONOMY_STARTING_BALANCE ?? 100) || 0;

const raw = JSON.parse(await readFile(source, "utf8")) as unknown;
if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
  console.error("That file isn't a { username: balance } object.");
  process.exit(1);
}

const store = new EconomyStore({ filePath: path.resolve(process.cwd(), dataDir, "economy.json"), startingBalance });
await store.load();
const added = store.importLegacy(raw as Record<string, unknown>);
await store.flush();
console.log(`Imported ${added} legacy balance(s) of ${Object.keys(raw).length} in the file (already-imported names are skipped).`);
