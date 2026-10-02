import { config } from "./config.js";

/**
 * Authorization gate. The agent holds powerful permissions, so three things must all be true:
 *
 *  1. WHICH SERVER: the request comes from DISCORD_GUILD_ID.
 *  2. WHICH CHANNEL: ALLOWED_CHANNEL_IDS is empty (any channel) or contains the channel
 *     (or, for threads, the thread's parent channel).
 *  3. WHO: the user is OWNER_USER_ID, listed in ALLOWED_USER_IDS, or has a role in ALLOWED_ROLE_IDS.
 */
export function isAuthorized(params: {
  guildId: string | null | undefined;
  channelId: string;
  /** Parent channel ID when the request comes from a thread. */
  parentChannelId?: string | null;
  userId: string;
  roleIds: Iterable<string>;
}): boolean {
  if (params.guildId !== config.guildId) return false;

  if (config.allowedChannelIds.length > 0) {
    const inAllowedChannel =
      config.allowedChannelIds.includes(params.channelId) ||
      (params.parentChannelId != null && config.allowedChannelIds.includes(params.parentChannelId));
    if (!inAllowedChannel) return false;
  }

  if (params.userId === config.ownerId) return true;
  if (config.allowedUserIds.includes(params.userId)) return true;
  for (const roleId of params.roleIds) {
    if (config.allowedRoleIds.includes(roleId)) return true;
  }
  return false;
}

/** Whether a request from the right server is merely in a channel the agent is not enabled for. */
export function isChannelAllowed(channelId: string, parentChannelId?: string | null): boolean {
  if (config.allowedChannelIds.length === 0) return true;
  return (
    config.allowedChannelIds.includes(channelId) ||
    (parentChannelId != null && config.allowedChannelIds.includes(parentChannelId))
  );
}
