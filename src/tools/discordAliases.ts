/**
 * Natural-language keywords → Discord operation_ids (and curated tools).
 * Used to boost discord_search_endpoints so "mute" finds the right ops.
 * Keep in sync with src/agent/skills/discord-api/SKILL.md.
 */
export const DISCORD_INTENT_ALIASES: Record<string, string[]> = {
  // Members / moderation
  mute: ["update_guild_member", "timeout_member"],
  unmute: ["update_guild_member"],
  timeout: ["update_guild_member"],
  silence: ["update_guild_member"],
  deafen: ["update_guild_member"],
  undeafen: ["update_guild_member"],
  voice_mute: ["update_guild_member"],
  kick: ["delete_guild_member"],
  ban: ["ban_user_from_guild", "bulk_ban_users_from_guild"],
  unban: ["unban_user_from_guild"],
  nickname: ["update_guild_member"],
  nick: ["update_guild_member"],
  prune: ["prune_guild", "preview_prune_guild"],

  // Messages
  purge: ["bulk_delete_messages"],
  bulk_delete: ["bulk_delete_messages"],
  clear: ["bulk_delete_messages"],
  pin: ["create_pin", "delete_pin", "list_pins"],
  unpin: ["delete_pin"],
  react: ["add_my_message_reaction", "delete_my_message_reaction"],
  reaction: ["add_my_message_reaction", "list_message_reactions_by_emoji"],

  // Channels
  channel: ["create_guild_channel", "update_channel", "delete_channel", "list_guild_channels"],
  slowmode: ["update_channel"],
  rate_limit: ["update_channel"],
  overwrite: ["set_channel_permission_overwrite", "delete_channel_permission_overwrite"],
  permissions: ["set_channel_permission_overwrite", "delete_channel_permission_overwrite"],
  category: ["create_guild_channel", "update_channel"],

  // Roles
  role: ["create_guild_role", "update_guild_role", "delete_guild_role", "add_guild_member_role", "delete_guild_member_role"],

  // Voice
  move: ["update_guild_member", "update_voice_state"],
  voice: ["update_guild_member", "get_voice_state", "update_voice_state", "list_guild_voice_regions", "update_voice_channel_status"],

  // Invites / audit / webhooks
  invite: ["create_channel_invite", "list_channel_invites", "list_guild_invites", "invite_revoke"],
  audit: ["list_guild_audit_log_entries"],
  webhook: ["create_webhook", "execute_webhook", "list_channel_webhooks", "delete_webhook"],

  // Server cosmetics / events
  emoji: ["create_guild_emoji", "list_guild_emojis", "delete_guild_emoji"],
  sticker: ["create_guild_sticker", "list_guild_stickers", "delete_guild_sticker"],
  event: ["create_guild_scheduled_event", "list_guild_scheduled_events", "delete_guild_scheduled_event"],
  thread: ["create_thread", "create_thread_from_message", "list_public_archived_threads"],
  automod: ["create_auto_moderation_rule", "list_auto_moderation_rules", "update_auto_moderation_rule"],
  welcome: ["update_guild_welcome_screen", "get_guild_welcome_screen"],
  onboarding: ["get_guilds_onboarding", "put_guilds_onboarding"],
};
