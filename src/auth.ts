import { config } from "./config.js";

/** Returned to the model when a non-admin tries to change Discord. */
export const DISCORD_CONTROL_DENIED =
  "Only the bot owner and allowed admins can change Discord. That includes moderation " +
  "(kick, ban, timeout, purge, vote timeout), channels, roles, permissions, and sending or deleting messages. " +
  "This person can still use music, games, economy, images, and CS lookups.";

export class DiscordControlError extends Error {
  constructor() {
    super(DISCORD_CONTROL_DENIED);
    this.name = "DiscordControlError";
  }
}

export interface AccessRules {
  guildId: string;
  allowedChannelIds: readonly string[];
  ownerId: string;
  controllerUserIds: readonly string[];
  controllerRoleIds: readonly string[];
}

/**
 * Anyone in the configured server (and an allowed channel) may use the bot.
 * Only the owner, ALLOWED_USER_IDS, and ALLOWED_ROLE_IDS may change Discord.
 */
export function accessFor(
  params: {
    guildId: string | null | undefined;
    channelId: string;
    parentChannelId?: string | null;
    userId: string;
    roleIds: Iterable<string>;
  },
  rules: AccessRules,
): { allowed: boolean; discordControl: boolean } {
  const inChannel =
    rules.allowedChannelIds.length === 0 ||
    rules.allowedChannelIds.includes(params.channelId) ||
    (params.parentChannelId != null && rules.allowedChannelIds.includes(params.parentChannelId));
  const allowed = params.guildId === rules.guildId && inChannel;
  let discordControl = params.userId === rules.ownerId || rules.controllerUserIds.includes(params.userId);
  if (!discordControl) {
    for (const roleId of params.roleIds) {
      if (rules.controllerRoleIds.includes(roleId)) {
        discordControl = true;
        break;
      }
    }
  }
  return { allowed, discordControl };
}

/** Non-GET Discord REST calls change the server and are limited to discord controllers. */
export function discordWriteAllowed(method: string, discordControl: boolean): boolean {
  return discordControl || method.toUpperCase() === "GET";
}

function rules(): AccessRules {
  return {
    guildId: config.guildId,
    allowedChannelIds: config.allowedChannelIds,
    ownerId: config.ownerId,
    controllerUserIds: config.allowedUserIds,
    controllerRoleIds: config.allowedRoleIds,
  };
}

/**
 * May this person talk to the bot here?
 * Server and channel still apply. Every member of the server is allowed.
 */
export function isAuthorized(params: {
  guildId: string | null | undefined;
  channelId: string;
  /** Parent channel ID when the request comes from a thread. */
  parentChannelId?: string | null;
  userId: string;
  roleIds: Iterable<string>;
}): boolean {
  return accessFor(params, rules()).allowed;
}

/** Owner, ALLOWED_USER_IDS, or ALLOWED_ROLE_IDS — the only people who may change Discord. */
export function canControlDiscord(params: { userId: string; roleIds: Iterable<string> }): boolean {
  return accessFor(
    { guildId: config.guildId, channelId: "", userId: params.userId, roleIds: params.roleIds },
    { ...rules(), allowedChannelIds: [] },
  ).discordControl;
}

/** Whether a request from the right server is merely in a channel the agent is not enabled for. */
export function isChannelAllowed(channelId: string, parentChannelId?: string | null): boolean {
  if (config.allowedChannelIds.length === 0) return true;
  return (
    config.allowedChannelIds.includes(channelId) ||
    (parentChannelId != null && config.allowedChannelIds.includes(parentChannelId))
  );
}
