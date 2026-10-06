import { fetchJson, fetchText, stripTags } from "../http.js";
import { summarizeLibrary, type SteamLibraryGame } from "./steam-games.js";

const PERSONA_STATE = ["Offline", "Online", "Busy", "Away", "Snooze", "Looking to trade", "Looking to play"];
const FRIEND_SAMPLE = 10;
const GROUP_SAMPLE = 15;
const BADGE_SAMPLE = 8;

export interface SteamBadge {
  name: string;
  level?: number;
  xp?: number;
}

export interface SteamFriend {
  steamId64: string;
  personaName?: string;
  friendsSince?: string;
}

export interface SteamGroup {
  name: string;
  url?: string;
  primary?: boolean;
}

export interface SteamPublicProfile {
  steamId64: string;
  profileUrl: string;
  profileVisibility: "public" | "private" | "friends_only" | "unknown";
  identity: {
    personaName?: string;
    realName?: string;
    avatarUrl?: string;
    customUrl?: string;
    country?: string;
    location?: string;
    memberSince?: string;
    createdAt?: string;
    limitedAccount?: boolean;
    summary?: string;
  };
  presence: {
    status: string;
    lastLogoff?: string;
    currentGame?: string;
  };
  bans: {
    vac: boolean;
    numberOfVacBans?: number;
    numberOfGameBans?: number;
    communityBanned: boolean;
    economyBan?: string;
    daysSinceLastBan?: number;
    tradeBan?: string;
  };
  level?: {
    level: number;
    xp?: number;
    xpToNextLevel?: number;
  };
  badges: {
    visibility: "public" | "private" | "unavailable";
    count?: number;
    featured: SteamBadge[];
  };
  friends: {
    visibility: "public" | "private" | "unavailable";
    count?: number;
    sample: SteamFriend[];
  };
  groups: {
    visibility: "public" | "private" | "unknown";
    count?: number;
    sample: SteamGroup[];
  };
  games: {
    visibility: "public" | "private";
    gameCount?: number;
    recent: SteamLibraryGame[];
    mostPlayed: SteamLibraryGame[];
    note?: string;
  };
  notes: string[];
}

interface RawPlayer {
  personaname?: string;
  realname?: string;
  profileurl?: string;
  avatarfull?: string;
  loccountrycode?: string;
  communityvisibilitystate?: number;
  personastate?: number;
  lastlogoff?: number;
  timecreated?: number;
  gameextrainfo?: string;
}

interface RawBan {
  VACBanned?: boolean;
  NumberOfVACBans?: number;
  NumberOfGameBans?: number;
  CommunityBanned?: boolean;
  EconomyBan?: string;
  DaysSinceLastBan?: number;
}

interface RawBadge {
  badgeid?: number;
  appid?: number;
  level?: number;
  xp?: number;
}

interface RawFriend {
  steamid?: string;
  friend_since?: number;
}

interface ProfileXml {
  privacy?: "public" | "private" | "friends_only";
  customUrl?: string;
  memberSince?: string;
  location?: string;
  realName?: string;
  summary?: string;
  limitedAccount?: boolean;
  tradeBan?: string;
  groups: SteamGroup[];
}

export function profileVisibility(state: unknown): SteamPublicProfile["profileVisibility"] {
  const n = Number(state);
  if (n === 3) return "public";
  if (n === 1) return "private";
  if (n === 2) return "friends_only";
  return "unknown";
}

export function personaStatus(state: unknown): string {
  const n = Number(state);
  return PERSONA_STATE[n] ?? "Unknown";
}

export function unixIso(value: unknown): string | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n * 1000).toISOString();
}

function xmlValue(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>(?:\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`, "i");
  const value = (block.match(re)?.[1] ?? block.match(re)?.[2] ?? "").replace(/\s+/g, " ").trim();
  return value || undefined;
}

export function parseProfileXml(xml: string): ProfileXml | null {
  if (!/<profile\b/i.test(xml)) return null;
  const privacyRaw = xmlValue(xml, "privacyState")?.toLowerCase();
  const privacy =
    privacyRaw === "public" || privacyRaw === "private"
      ? privacyRaw
      : privacyRaw === "friendsonly"
        ? "friends_only"
        : undefined;
  const summaryRaw = xml.match(/<summary>(?:\s*<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/summary>/i);
  const summaryText = stripTags((summaryRaw?.[1] ?? summaryRaw?.[2] ?? "").replace(/<br\s*\/?>/gi, "\n")).trim();
  const groups: SteamGroup[] = [];
  for (const match of xml.matchAll(/<group\b([^>]*)>([\s\S]*?)<\/group>/gi)) {
    const name = xmlValue(match[2] ?? "", "groupName");
    if (!name) continue;
    groups.push({
      name,
      url: xmlValue(match[2] ?? "", "groupURL"),
      ...( /isPrimary=["']1["']/i.test(match[1] ?? "") ? { primary: true } : {}),
    });
  }
  const limited = xmlValue(xml, "isLimitedAccount");
  const trade = xmlValue(xml, "tradeBanState");
  return {
    privacy,
    customUrl: xmlValue(xml, "customURL"),
    memberSince: xmlValue(xml, "memberSince"),
    location: xmlValue(xml, "location"),
    realName: xmlValue(xml, "realname"),
    summary: summaryText ? summaryText.slice(0, 500) : undefined,
    limitedAccount: limited === undefined ? undefined : limited === "1",
    tradeBan: trade && !/^none$/i.test(trade) ? trade : undefined,
    groups,
  };
}

export function badgeName(badge: RawBadge, gameNames: Map<number, string>): string {
  if (typeof badge.appid === "number") {
    return `${gameNames.get(badge.appid) ?? `App ${badge.appid}`} badge`;
  }
  if (badge.badgeid === 1) return "Years of Service";
  return `Community badge ${badge.badgeid ?? "?"}`;
}

export function pickFeaturedBadges(badges: RawBadge[], gameNames: Map<number, string>): SteamBadge[] {
  const mapped = badges
    .filter((b) => typeof b.badgeid === "number" || typeof b.appid === "number")
    .map((b) => ({
      name: badgeName(b, gameNames),
      ...(typeof b.level === "number" ? { level: b.level } : {}),
      ...(typeof b.xp === "number" ? { xp: b.xp } : {}),
      years: b.badgeid === 1 && typeof b.appid !== "number",
    }));
  const years = mapped.find((b) => b.years);
  const rest = mapped
    .filter((b) => !b.years)
    .sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0) || a.name.localeCompare(b.name));
  return [...(years ? [years] : []), ...rest].slice(0, BADGE_SAMPLE).map(({ name, level, xp }) => ({
    name,
    ...(level != null ? { level } : {}),
    ...(xp != null ? { xp } : {}),
  }));
}

export function buildSteamProfile(input: {
  steamId64: string;
  player?: RawPlayer;
  ban?: RawBan;
  badges?: { player_level?: number; player_xp?: number; player_xp_needed_to_level_up?: number; badges?: RawBadge[] };
  badgesVisibility?: "public" | "private" | "unavailable";
  friends?: RawFriend[];
  friendsVisibility?: "public" | "private" | "unavailable";
  friendNames?: Map<string, string>;
  xml?: ProfileXml | null;
  owned?: { game_count?: number; games?: { appid?: number; name?: string; playtime_forever?: number; playtime_2weeks?: number }[] };
  recent?: { appid?: number; name?: string; playtime_forever?: number; playtime_2weeks?: number }[];
  gameLimit: number;
  notes?: string[];
}): SteamPublicProfile {
  const player = input.player ?? {};
  const xml = input.xml ?? undefined;
  const library = summarizeLibrary({
    steamId64: input.steamId64,
    personaName: player.personaname,
    profileUrl: player.profileurl,
    owned: input.owned,
    recent: input.recent,
    limit: input.gameLimit,
  });
  const gameNames = new Map<number, string>();
  for (const game of input.owned?.games ?? []) {
    if (typeof game.appid === "number" && game.name) gameNames.set(game.appid, game.name);
  }
  const badgeList = input.badges?.badges ?? [];
  const badgesVisibility =
    input.badgesVisibility ??
    (input.badges?.player_level != null || badgeList.length > 0 ? "public" : "private");
  const friendsVisibility = input.friendsVisibility ?? "public";
  const friends = input.friends ?? [];
  const sample = [...friends]
    .filter((f) => typeof f.steamid === "string" && f.steamid)
    .sort((a, b) => Number(b.friend_since ?? 0) - Number(a.friend_since ?? 0))
    .slice(0, FRIEND_SAMPLE)
    .map((f) => ({
      steamId64: f.steamid!,
      ...(input.friendNames?.get(f.steamid!) ? { personaName: input.friendNames.get(f.steamid!) } : {}),
      ...(unixIso(f.friend_since) ? { friendsSince: unixIso(f.friend_since) } : {}),
    }));
  const groups = xml?.groups ?? [];
  const ban = input.ban ?? {};
  const economy = typeof ban.EconomyBan === "string" && !/^none$/i.test(ban.EconomyBan) ? ban.EconomyBan : undefined;

  return {
    steamId64: input.steamId64,
    profileUrl: player.profileurl || library.profileUrl,
    profileVisibility:
      profileVisibility(player.communityvisibilitystate) === "unknown"
        ? (xml?.privacy ?? "unknown")
        : profileVisibility(player.communityvisibilitystate),
    identity: {
      personaName: player.personaname ?? library.personaName,
      realName: player.realname ?? xml?.realName,
      avatarUrl: player.avatarfull,
      customUrl: xml?.customUrl,
      country: player.loccountrycode,
      location: xml?.location,
      memberSince: xml?.memberSince,
      createdAt: unixIso(player.timecreated),
      limitedAccount: xml?.limitedAccount,
      summary: xml?.summary,
    },
    presence: {
      status: personaStatus(player.personastate),
      lastLogoff: unixIso(player.lastlogoff),
      currentGame: typeof player.gameextrainfo === "string" ? player.gameextrainfo : undefined,
    },
    bans: {
      vac: Boolean(ban.VACBanned),
      ...(Number(ban.NumberOfVACBans) > 0 ? { numberOfVacBans: Number(ban.NumberOfVACBans) } : {}),
      ...(Number(ban.NumberOfGameBans) > 0 ? { numberOfGameBans: Number(ban.NumberOfGameBans) } : {}),
      communityBanned: Boolean(ban.CommunityBanned),
      ...(economy ? { economyBan: economy } : {}),
      ...(Number(ban.DaysSinceLastBan) > 0 ? { daysSinceLastBan: Number(ban.DaysSinceLastBan) } : {}),
      ...(xml?.tradeBan ? { tradeBan: xml.tradeBan } : {}),
    },
    ...(badgesVisibility === "public" && typeof input.badges?.player_level === "number"
      ? {
          level: {
            level: input.badges.player_level,
            ...(typeof input.badges.player_xp === "number" ? { xp: input.badges.player_xp } : {}),
            ...(typeof input.badges.player_xp_needed_to_level_up === "number"
              ? { xpToNextLevel: input.badges.player_xp_needed_to_level_up }
              : {}),
          },
        }
      : {}),
    badges: {
      visibility: badgesVisibility,
      ...(badgesVisibility === "public"
        ? { count: badgeList.length, featured: pickFeaturedBadges(badgeList, gameNames) }
        : { featured: [] }),
    },
    friends: {
      visibility: friendsVisibility,
      ...(friendsVisibility === "public" ? { count: friends.length, sample } : { sample: [] }),
    },
    groups: {
      visibility:
        groups.length > 0 || xml?.privacy === "public"
          ? "public"
          : xml?.privacy === "private" || xml?.privacy === "friends_only"
            ? "private"
            : "unknown",
      ...(groups.length > 0 || xml?.privacy === "public"
        ? { count: groups.length, sample: groups.slice(0, GROUP_SAMPLE) }
        : { sample: [] }),
    },
    games: {
      visibility: library.visibility,
      ...(library.gameCount != null ? { gameCount: library.gameCount } : {}),
      recent: library.recent,
      mostPlayed: library.mostPlayed,
      ...(library.note ? { note: library.note } : {}),
    },
    notes: input.notes ?? [],
  };
}

export async function fetchSteamProfile(
  steamId64: string,
  apiKey: string,
  gameLimit: number,
): Promise<SteamPublicProfile> {
  const summaryUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  summaryUrl.searchParams.set("key", apiKey);
  summaryUrl.searchParams.set("steamids", steamId64);

  const bansUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/");
  bansUrl.searchParams.set("key", apiKey);
  bansUrl.searchParams.set("steamids", steamId64);

  const ownedUrl = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
  ownedUrl.searchParams.set("key", apiKey);
  ownedUrl.searchParams.set("steamid", steamId64);
  ownedUrl.searchParams.set("include_appinfo", "true");
  ownedUrl.searchParams.set("include_played_free_games", "true");

  const recentUrl = new URL("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/");
  recentUrl.searchParams.set("key", apiKey);
  recentUrl.searchParams.set("steamid", steamId64);
  recentUrl.searchParams.set("count", String(Math.max(gameLimit, 20)));

  const badgesUrl = new URL("https://api.steampowered.com/IPlayerService/GetBadges/v1/");
  badgesUrl.searchParams.set("key", apiKey);
  badgesUrl.searchParams.set("steamid", steamId64);

  const friendsUrl = new URL("https://api.steampowered.com/ISteamUser/GetFriendList/v1/");
  friendsUrl.searchParams.set("key", apiKey);
  friendsUrl.searchParams.set("steamid", steamId64);
  friendsUrl.searchParams.set("relationship", "friend");

  const notes: string[] = [];
  const [summary, bans, owned, recent, badges, friends, xmlRes] = await Promise.all([
    fetchJson<{ response?: { players?: RawPlayer[] } }>(summaryUrl.toString()),
    fetchJson<{ players?: RawBan[] }>(bansUrl.toString()),
    fetchJson<{ response?: { game_count?: number; games?: { appid?: number; name?: string; playtime_forever?: number; playtime_2weeks?: number }[] } }>(
      ownedUrl.toString(),
    ),
    fetchJson<{ response?: { games?: { appid?: number; name?: string; playtime_forever?: number; playtime_2weeks?: number }[] } }>(
      recentUrl.toString(),
    ),
    fetchJson<{ response?: { player_level?: number; player_xp?: number; player_xp_needed_to_level_up?: number; badges?: RawBadge[] } }>(
      badgesUrl.toString(),
    ),
    fetchJson<{ friendslist?: { friends?: RawFriend[] } }>(friendsUrl.toString()),
    fetchText(`https://steamcommunity.com/profiles/${steamId64}?xml=1`),
  ]);

  if (!summary.ok) {
    throw new Error(`Steam profile request failed (${summary.status}).`);
  }
  if (!owned.ok) notes.push(`Owned games request failed (${owned.status}).`);

  const badgeBody = badges.ok ? badges.data?.response : undefined;
  const badgesVisibility: "public" | "private" | "unavailable" = !badges.ok
    ? badges.status === 401 || badges.status === 403
      ? "private"
      : "unavailable"
    : badgeBody?.player_level != null || (badgeBody?.badges?.length ?? 0) > 0
      ? "public"
      : "private";
  if (badgesVisibility === "unavailable") notes.push(`Badges request failed (${badges.status}).`);

  const friendRows = friends.ok ? friends.data?.friendslist?.friends ?? [] : [];
  const friendsVisibility: "public" | "private" | "unavailable" = friends.ok
    ? "public"
    : friends.status === 401 || friends.status === 403
      ? "private"
      : "unavailable";
  if (friendsVisibility === "unavailable") notes.push(`Friends request failed (${friends.status}).`);

  const sampleIds = [...friendRows]
    .filter((f) => typeof f.steamid === "string")
    .sort((a, b) => Number(b.friend_since ?? 0) - Number(a.friend_since ?? 0))
    .slice(0, FRIEND_SAMPLE)
    .map((f) => f.steamid!)
    .filter(Boolean);
  const friendNames = new Map<string, string>();
  if (sampleIds.length > 0) {
    const namesUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
    namesUrl.searchParams.set("key", apiKey);
    namesUrl.searchParams.set("steamids", sampleIds.join(","));
    const names = await fetchJson<{ response?: { players?: { steamid?: string; personaname?: string }[] } }>(
      namesUrl.toString(),
    );
    for (const player of names.data?.response?.players ?? []) {
      if (player.steamid && player.personaname) friendNames.set(player.steamid, player.personaname);
    }
  }

  const xml = xmlRes.ok ? parseProfileXml(xmlRes.text) : null;
  if (!xmlRes.ok) notes.push(`Profile page request failed (${xmlRes.status}).`);

  return buildSteamProfile({
    steamId64,
    player: summary.data?.response?.players?.[0],
    ban: bans.ok ? bans.data?.players?.[0] : undefined,
    badges: badgeBody,
    badgesVisibility,
    friends: friendRows,
    friendsVisibility,
    friendNames,
    xml,
    owned: owned.ok ? owned.data?.response : undefined,
    recent: recent.ok ? recent.data?.response?.games : undefined,
    gameLimit,
    notes,
  });
}
