import type { CharacterId } from "./characters/types.js";

const MUSIC = [
  "load_skill",
  "music_join",
  "music_leave",
  "music_play",
  "music_add",
  "music_skip",
  "music_stop",
  "music_clear",
  "music_queue",
  "music_move",
  "music_remove",
  "music_pause",
  "music_resume",
] as const;

const DISCORD = [
  "load_skill",
  "send_message",
  "read_messages",
  "list_channels",
  "create_channel",
  "list_roles",
  "find_members",
  "manage_roles",
  "kick_member",
  "timeout_member",
  "purge_messages",
  "start_vote_timeout",
  "discord_search_endpoints",
  "discord_call",
] as const;

const STEAM = [
  "load_skill",
  "find_members",
  "post_embed",
  "cs_link_steam",
  "cs_unlink_steam",
  "cs_list_links",
  "cs_set_primary",
  "cs_player",
  "cs_compare",
  "cs_leetify",
  "cs_refresh",
  "steam_profile",
  "cs_leaderboard",
] as const;

const SASSY = [
  "load_skill",
  "post_embed",
  "show_damien",
  "economy_balance",
  "economy_leaderboard",
  "play_blackjack",
  "play_coinflip",
  "generate_image",
] as const;

const BY_CHARACTER: Record<CharacterId, readonly string[]> = {
  sassy: SASSY,
  clarence: MUSIC,
  mike: DISCORD,
  donny: STEAM,
};

export function toolNamesFor(id: CharacterId): ReadonlySet<string> {
  return new Set(BY_CHARACTER[id]);
}

/** Who owns which work, and how a bot that does not own it hands the request over. */
export function jobRules(id: CharacterId): string {
  const yours: Record<CharacterId, string> = {
    clarence:
      "Music is yours. Join the voice channel, play, queue, skip, stop, pause, resume, leave, and say what is playing. A music request is an order. Call the music tool immediately. You always do it. After the tool result, one short timid loyal line. You do not refuse music, stall, or pass it back.",
    mike:
      "Discord administration is yours. Channels, roles, messages, kicks, bans, timeouts, purges, permissions, and any other Discord change. Do that work with your tools.",
    donny:
      "Steam profiles and CS lookups are yours. Use the cs_* tools and steam_profile. Do that work with your tools. Reply from the tool result only.",
    sassy:
      "Coins, blackjack, coinflip, images, and Damien's sticker are yours. Do that work with your tools.",
  };
  return `## Jobs
${yours[id]}

Music belongs to Clarence. Discord administration belongs to Nolzy (Mike Nolan). Steam and CS belong to Donny the Dealer. Coins, blackjack, coinflip, images, and Damien belong to Sassy the Sasquatch.

If the request is not your job, do not call a tool and do not do the work. Hand it to the owner. One short reply. @mention only that owner and repeat the request exactly.
Music is the loud handoff. If you are not Clarence and they asked for music, be aggressive. Order Clarence. No apology. No "I can't". No "not my job".
A job you finished does not @mention anyone. A handoff @mentions only the owner. Casual chat is the only time you @mention someone for conversation.`;
}
