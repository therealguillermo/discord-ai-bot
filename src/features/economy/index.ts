import type { Client } from "discord.js";
import { config } from "../../config.js";
import type { ToolDefinition } from "../../tools/types.js";
import type { Feature, PrefixCommand } from "../types.js";
import { economy, formatCoins, touch } from "./instance.js";

/* -------------------------------------------------------------------------- */
/* Voice pay                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Pay everyone sitting in a voice channel. Unlike the old bot this skips bots, the AFK channel,
 * deafened members, and channels where you'd be farming alone.
 */
function payVoice(client: Client): void {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;

  let paid = 0;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isVoiceBased() || channel.id === guild.afkChannelId) continue;
    const humans = channel.members.filter((m) => !m.user.bot);
    if (humans.size < config.voicePayMinHumans) continue;
    for (const member of humans.values()) {
      if (member.voice.deaf) continue; // self or server deafened
      economy.credit(member.id, config.voicePayAmount);
      paid++;
    }
  }
  if (paid > 0) console.log(`[economy] paid ${config.voicePayAmount} coins to ${paid} voice member(s)`);
}

let payTimer: NodeJS.Timeout | null = null;

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

const coins: PrefixCommand = {
  name: "coins",
  aliases: ["balance", "bal"],
  description: "Show your coin balance.",
  execute: async (ctx) => {
    const { balance, claimed } = touch(ctx.message.author);
    const note = claimed > 0 ? `\nImported ${formatCoins(claimed)} coins from the old bot.` : "";
    await ctx.reply(`You have **${formatCoins(balance)}** coins.${note}`);
  },
};

const register: PrefixCommand = {
  name: "register",
  description: "Create your account (this happens automatically the first time you use any coin command).",
  execute: async (ctx) => {
    const { balance, created, claimed } = touch(ctx.message.author);
    const note = claimed > 0 ? ` Imported ${formatCoins(claimed)} coins from the old bot.` : "";
    await ctx.reply(
      created
        ? `Account created - you have **${formatCoins(balance)}** coins.${note}`
        : `You're already registered with **${formatCoins(balance)}** coins.${note}`,
    );
  },
};

const leaderboard: PrefixCommand = {
  name: "leaderboard",
  aliases: ["top", "lb"],
  description: "Show the richest members.",
  execute: async (ctx) => {
    const rows = economy.leaderboard(10);
    if (rows.length === 0) {
      await ctx.reply("Nobody has any coins yet.");
      return;
    }
    const lines = rows.map((r, i) => `${i + 1}. <@${r.userId}> - ${formatCoins(r.balance)}`);
    await ctx.reply(`**Top coin holders**\n${lines.join("\n")}`);
  },
};

/* -------------------------------------------------------------------------- */
/* Agent tools (read-only: the agent can never create or move coins)          */
/* -------------------------------------------------------------------------- */

const balanceTool: ToolDefinition = {
  name: "economy_balance",
  description: "Look up a member's coin balance in the server's coin economy. Read-only.",
  input_schema: {
    type: "object",
    properties: { user_id: { type: "string", description: "Discord user ID." } },
    required: ["user_id"],
  },
  handler: async (input) => {
    const userId = String(input.user_id ?? "");
    if (!/^\d{15,25}$/.test(userId)) throw new Error("user_id must be a Discord user ID.");
    return { user_id: userId, registered: economy.has(userId), balance: economy.getBalance(userId) };
  },
};

const leaderboardTool: ToolDefinition = {
  name: "economy_leaderboard",
  description: "Show the top coin holders in the server's coin economy. Read-only.",
  input_schema: {
    type: "object",
    properties: { limit: { type: "integer", description: "1-25, default 10." } },
  },
  handler: async (input) => {
    const limit = Math.min(25, Math.max(1, Number(input.limit ?? 10) || 10));
    return economy.leaderboard(limit);
  },
};

/* -------------------------------------------------------------------------- */

export const economyFeature: Feature = {
  name: "Economy",
  commands: [coins, register, leaderboard],
  tools: [balanceTool, leaderboardTool],
  start: async (client) => {
    const { refunded } = await economy.load();
    if (refunded > 0) console.log(`[economy] refunded ${refunded} bet(s) left in escrow by a previous crash`);
    if (config.voicePayAmount > 0) {
      payTimer = setInterval(() => {
        try {
          payVoice(client);
        } catch (err) {
          console.error("[economy] voice pay failed:", err);
        }
      }, config.voicePayIntervalMs);
      payTimer.unref?.();
    }
  },
  stop: async () => {
    if (payTimer) clearInterval(payTimer);
    payTimer = null;
    await economy.flush();
  },
};
