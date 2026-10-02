import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type SendableChannels,
} from "discord.js";
import { config } from "../../config.js";
import { audit } from "../../safety/confirm.js";
import { resolveGuildChannel, resolveSendableChannel } from "../../tools/channels.js";
import type { ToolDefinition } from "../../tools/types.js";
import { UserError, type Feature } from "../types.js";

/* -------------------------------------------------------------------------- */
/* purge (agent tool)                                                         */
/* -------------------------------------------------------------------------- */

const MAX_PURGE = 100; // bulkDelete takes 2-100 messages

const purgeTool: ToolDefinition = {
  name: "purge_messages",
  description:
    "Delete the most recent N messages in a channel (1-100; defaults to the current channel). The request message " +
    "and your own progress message are left alone. Messages older than 14 days cannot be bulk-deleted and are " +
    "skipped. Requires human confirmation.",
  input_schema: {
    type: "object",
    properties: {
      count: { type: "integer", description: `How many messages to delete (1-${MAX_PURGE}).` },
      channel_id: { type: "string", description: "Default: the current channel." },
    },
    required: ["count"],
  },
  destructive: true,
  describeAction: (input) =>
    `Delete the last ${Number(input.count) || "?"} message(s) in ${input.channel_id ? `<#${String(input.channel_id)}>` : "this channel"}`,
  handler: async (input, ctx) => {
    const count = Number(input.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PURGE) {
      throw new Error(`count must be a whole number from 1 to ${MAX_PURGE}.`);
    }
    const channel = await resolveGuildChannel(ctx, input.channel_id);
    if (!channel.isTextBased() || !("bulkDelete" in channel)) {
      throw new Error("I can't purge messages in that kind of channel.");
    }
    const me = channel.guild.members.me;
    if (!me?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) {
      throw new Error("I don't have the Manage Messages permission in that channel.");
    }

    // Skip the message that triggered this request (only relevant in the channel it was sent in).
    const before = channel.id === ctx.channelId ? ctx.triggerMessageId : undefined;
    const messages = await channel.messages.fetch({ limit: count, ...(before ? { before } : {}) });
    // `true` skips messages older than 14 days (Discord can't bulk-delete those).
    const deleted = await channel.bulkDelete(messages, true);
    return {
      ok: true,
      deleted: deleted.size,
      requested: count,
      note:
        deleted.size < count
          ? "Fewer were deleted than requested (the channel ran out, or messages were older than 14 days)."
          : undefined,
    };
  },
};

/* -------------------------------------------------------------------------- */
/* votetimeout                                                                */
/* -------------------------------------------------------------------------- */

const VOTE_WINDOW_MS = 60_000;
const MIN_MINUTES = 1;
const MAX_MINUTES = 30;
const DEFAULT_MINUTES = 5;
const TARGET_COOLDOWN_MS = 10 * 60_000;
const REQUESTER_COOLDOWN_MS = 120_000;

const activeVotes = new Set<string>();
const recentTargets = new Map<string, number>();
const recentRequesters = new Map<string, number>();

async function startVoteTimeout(params: {
  guild: Guild;
  channel: SendableChannels;
  requesterId: string;
  requesterTag: string;
  targetId: string;
  minutes?: number;
}): Promise<{ ok: true; target_id: string; minutes: number; needed: number }> {
  const { guild, channel, requesterId, requesterTag, targetId } = params;

  const requesterCooldownUntil = recentRequesters.get(requesterId) ?? 0;
  if (Date.now() < requesterCooldownUntil) {
    throw new UserError("Slow down - you started a timeout vote recently.");
  }

  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) throw new UserError("I couldn't find that member in this server.");

  if (target.user.bot) throw new UserError("You can't vote to time out a bot.");
  if (target.id === requesterId) throw new UserError("You can't start a timeout vote against yourself.");
  if (target.id === config.ownerId || target.permissions.has(PermissionFlagsBits.Administrator)) {
    throw new UserError("That member can't be put up for a timeout vote.");
  }
  if (!target.moderatable) throw new UserError("I can't time that member out (their role is above mine).");
  if (activeVotes.has(target.id)) throw new UserError("There's already a vote running for that member.");
  const cooldownUntil = recentTargets.get(target.id) ?? 0;
  if (Date.now() < cooldownUntil) {
    throw new UserError("That member was voted on recently. Give it a while before trying again.");
  }

  const duration = params.minutes === undefined ? DEFAULT_MINUTES : Number(params.minutes);
  if (!Number.isInteger(duration) || duration < MIN_MINUTES || duration > MAX_MINUTES) {
    throw new UserError(`Timeout length must be ${MIN_MINUTES}-${MAX_MINUTES} minutes.`);
  }

  const needed = config.voteTimeoutMinVotes;
  const yes = new Set<string>([requesterId]);
  const no = new Set<string>();
  const endsAt = Math.floor((Date.now() + VOTE_WINDOW_MS) / 1000);

  const embed = (final?: string) =>
    new EmbedBuilder()
      .setTitle("Timeout vote")
      .setColor(0xff5733)
      .setDescription(
        `Time out <@${target.id}> for **${duration} minute(s)**?\n` +
          `Needs **${needed}** yes votes and more yes than no. ${final ?? `Voting ends <t:${endsAt}:R>.`}`,
      )
      .addFields(
        { name: "Yes", value: String(yes.size), inline: true },
        { name: "No", value: String(no.size), inline: true },
      );

  const row = (disabled = false) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("vt:yes").setLabel("Yes").setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId("vt:no").setLabel("No").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    );

  activeVotes.add(target.id);
  recentRequesters.set(requesterId, Date.now() + REQUESTER_COOLDOWN_MS);
  let msg;
  try {
    msg = await channel.send({
      embeds: [embed()],
      components: [row()],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    activeVotes.delete(target.id);
    throw err;
  }

  const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: VOTE_WINDOW_MS });
  collector.on("collect", async (i: ButtonInteraction) => {
    try {
      if (i.user.bot) return;
      if (i.user.id === target.id) {
        await i.reply({ content: "You can't vote in your own timeout vote.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (i.customId === "vt:yes") {
        no.delete(i.user.id);
        yes.add(i.user.id);
      } else {
        yes.delete(i.user.id);
        no.add(i.user.id);
      }
      await i.update({ embeds: [embed()], components: [row()] });
    } catch (err) {
      console.error("[votetimeout] interaction failed:", err);
    }
  });

  collector.on("end", async () => {
    activeVotes.delete(target.id);
    recentTargets.set(target.id, Date.now() + TARGET_COOLDOWN_MS);
    const passed = yes.size >= needed && yes.size > no.size;
    let result: string;
    if (!passed) {
      result = `Vote failed (${yes.size} yes / ${no.size} no, needed ${needed}).`;
    } else {
      try {
        const fresh = await guild.members.fetch(target.id);
        await fresh.timeout(
          duration * 60_000,
          `Vote by members (${yes.size} yes / ${no.size} no), started by ${requesterTag}`,
        );
        result = `Vote passed (${yes.size} yes / ${no.size} no). <@${target.id}> is timed out for ${duration} minute(s).`;
        await audit({
          requesterId,
          channelId: channel.id,
          tool: "start_vote_timeout",
          input: { target: target.id, minutes: duration, yes: [...yes], no: [...no] },
          outcome: "ok",
        });
      } catch (err) {
        console.error("[votetimeout] timeout failed:", err);
        result = "The vote passed, but I couldn't apply the timeout (missing permission or role hierarchy).";
      }
    }
    await msg
      .edit({ embeds: [embed(result)], components: [row(true)], allowedMentions: { parse: [] } })
      .catch(() => undefined);
  });

  return { ok: true, target_id: target.id, minutes: duration, needed };
}

const voteTimeoutTool: ToolDefinition = {
  name: "start_vote_timeout",
  description:
    `Start a community vote to time out a member (needs ${config.voteTimeoutMinVotes} yes votes and more yes than no). ` +
    "Posts Yes/No buttons in the channel. Only use when the requester asks to start a vote timeout — for an " +
    "immediate timeout use timeout_member instead. Resolve the target with find_members first if you only have a name.",
  input_schema: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "Discord user ID of the member to put up for a timeout vote." },
      minutes: {
        type: "integer",
        description: `Timeout length in minutes (${MIN_MINUTES}-${MAX_MINUTES}, default ${DEFAULT_MINUTES}).`,
      },
    },
    required: ["user_id"],
  },
  handler: async (input, ctx) => {
    const userId = String(input.user_id ?? "");
    if (!/^\d{15,25}$/.test(userId)) throw new Error("user_id must be a Discord user ID.");
    const minutes = input.minutes === undefined || input.minutes === null ? undefined : Number(input.minutes);
    const channel = await resolveSendableChannel(ctx);
    const guild = channel.guild;
    const requester = await ctx.client.users.fetch(ctx.requesterId);
    return startVoteTimeout({
      guild,
      channel,
      requesterId: ctx.requesterId,
      requesterTag: requester.tag,
      targetId: userId,
      minutes,
    });
  },
};

export const moderationFeature: Feature = {
  name: "Moderation",
  tools: [purgeTool, voteTimeoutTool],
};
