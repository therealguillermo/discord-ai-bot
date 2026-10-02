import { Events, type Client } from "discord.js";
import { config } from "../../config.js";
import type { ToolDefinition } from "../../tools/types.js";
import type { Feature } from "../types.js";
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

/** Ensure every human in the guild has an economy account (and pull legacy balances). */
async function seedMembers(client: Client): Promise<void> {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;
  await guild.members.fetch().catch((err) => {
    console.error("[economy] failed to fetch members for seeding:", err);
  });
  let created = 0;
  let claimed = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const result = touch(member.user);
    if (result.created) created++;
    claimed += result.claimed;
  }
  if (created > 0 || claimed > 0) {
    console.log(`[economy] seeded ${created} new account(s); imported ${formatCoins(claimed)} legacy coins`);
  }
}

/* -------------------------------------------------------------------------- */
/* Agent tools (read-only: the agent can never create or move coins)          */
/* -------------------------------------------------------------------------- */

const balanceTool: ToolDefinition = {
  name: "economy_balance",
  description:
    "Look up a member's coin balance in the server's coin economy. Read-only. Accounts are created automatically " +
    "when members join; use this when someone asks about their (or another's) balance.",
  input_schema: {
    type: "object",
    properties: { user_id: { type: "string", description: "Discord user ID." } },
    required: ["user_id"],
  },
  handler: async (input, ctx) => {
    const userId = String(input.user_id ?? "");
    if (!/^\d{15,25}$/.test(userId)) throw new Error("user_id must be a Discord user ID.");
    const user = await ctx.client.users.fetch(userId).catch(() => null);
    if (user && !user.bot) touch(user);
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
  tools: [balanceTool, leaderboardTool],
  start: async (client) => {
    const { refunded } = await economy.load();
    if (refunded > 0) console.log(`[economy] refunded ${refunded} bet(s) left in escrow by a previous crash`);

    await seedMembers(client);

    client.on(Events.GuildMemberAdd, (member) => {
      if (member.guild.id !== config.guildId || member.user.bot) return;
      const { created, claimed } = touch(member.user);
      if (created || claimed > 0) {
        console.log(
          `[economy] tracked <@${member.id}>` +
            (created ? " (new account)" : "") +
            (claimed > 0 ? ` (imported ${formatCoins(claimed)} legacy)` : ""),
        );
      }
    });

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
