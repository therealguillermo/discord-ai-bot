import { fetchJson } from "../http.js";

export interface SteamLibraryGame {
  appid: number;
  name: string;
  hours: number;
  hoursTwoWeeks?: number;
}

export interface SteamLibrary {
  steamId64: string;
  personaName?: string;
  profileUrl: string;
  /** Public game details, or hidden by the profile's privacy setting. */
  visibility: "public" | "private";
  gameCount?: number;
  /** Played in the last two weeks, most recent hours first. */
  recent: SteamLibraryGame[];
  /** Highest lifetime hours, games with no recorded playtime omitted. */
  mostPlayed: SteamLibraryGame[];
  note?: string;
}

interface RawGame {
  appid?: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
}

interface OwnedResponse {
  game_count?: number;
  games?: RawGame[];
}

export function hoursFromMinutes(minutes: number | undefined): number | undefined {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return undefined;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (minutes > 0 && hours === 0) return 0.1;
  return hours;
}

export function mapSteamGame(raw: RawGame): SteamLibraryGame | null {
  if (typeof raw.appid !== "number") return null;
  const hours = hoursFromMinutes(raw.playtime_forever) ?? 0;
  const recent = hoursFromMinutes(raw.playtime_2weeks);
  return {
    appid: raw.appid,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `App ${raw.appid}`,
    hours,
    ...(recent != null && recent > 0 ? { hoursTwoWeeks: recent } : {}),
  };
}

/** Steam omits `games` (and usually `game_count`) when game details are private. */
export function libraryVisibility(owned: OwnedResponse | undefined): "public" | "private" {
  if (!owned) return "private";
  if (Array.isArray(owned.games) || typeof owned.game_count === "number") return "public";
  return "private";
}

export function pickMostPlayed(games: SteamLibraryGame[], limit: number): SteamLibraryGame[] {
  return games
    .filter((g) => g.hours > 0)
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function pickRecent(games: SteamLibraryGame[], limit: number): SteamLibraryGame[] {
  return games
    .filter((g) => (g.hoursTwoWeeks ?? 0) > 0)
    .sort((a, b) => (b.hoursTwoWeeks ?? 0) - (a.hoursTwoWeeks ?? 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function summarizeLibrary(input: {
  steamId64: string;
  personaName?: string;
  profileUrl?: string;
  owned?: OwnedResponse;
  recent?: RawGame[];
  limit: number;
}): SteamLibrary {
  const visibility = libraryVisibility(input.owned);
  const profileUrl = input.profileUrl ?? `https://steamcommunity.com/profiles/${input.steamId64}`;
  if (visibility === "private") {
    return {
      steamId64: input.steamId64,
      personaName: input.personaName,
      profileUrl,
      visibility,
      recent: [],
      mostPlayed: [],
      note: "This Steam profile keeps game details private, so owned games and recent play are hidden.",
    };
  }

  const ownedGames = (input.owned?.games ?? [])
    .map(mapSteamGame)
    .filter((g): g is SteamLibraryGame => g != null);
  const recentGames = (input.recent ?? [])
    .map(mapSteamGame)
    .filter((g): g is SteamLibraryGame => g != null);
  const mostPlayed = pickMostPlayed(ownedGames, input.limit);
  const recent = pickRecent(recentGames.length > 0 ? recentGames : ownedGames, input.limit);

  return {
    steamId64: input.steamId64,
    personaName: input.personaName,
    profileUrl,
    visibility,
    gameCount: input.owned?.game_count ?? ownedGames.length,
    recent,
    mostPlayed,
    ...(recent.length === 0
      ? { note: "No games recorded in the last two weeks. mostPlayed is lifetime playtime." }
      : {}),
  };
}

export async function fetchSteamLibrary(
  steamId64: string,
  apiKey: string,
  limit: number,
): Promise<SteamLibrary> {
  const ownedUrl = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
  ownedUrl.searchParams.set("key", apiKey);
  ownedUrl.searchParams.set("steamid", steamId64);
  ownedUrl.searchParams.set("include_appinfo", "true");
  ownedUrl.searchParams.set("include_played_free_games", "true");

  const recentUrl = new URL("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/");
  recentUrl.searchParams.set("key", apiKey);
  recentUrl.searchParams.set("steamid", steamId64);
  recentUrl.searchParams.set("count", String(Math.max(limit, 20)));

  const summaryUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
  summaryUrl.searchParams.set("key", apiKey);
  summaryUrl.searchParams.set("steamids", steamId64);

  const [owned, recent, summary] = await Promise.all([
    fetchJson<{ response?: OwnedResponse }>(ownedUrl.toString()),
    fetchJson<{ response?: { games?: RawGame[] } }>(recentUrl.toString()),
    fetchJson<{ response?: { players?: { personaname?: string; profileurl?: string }[] } }>(
      summaryUrl.toString(),
    ),
  ]);

  if (!owned.ok) {
    throw new Error(`Steam owned-games request failed (${owned.status}).`);
  }

  const player = summary.data?.response?.players?.[0];
  return summarizeLibrary({
    steamId64,
    personaName: typeof player?.personaname === "string" ? player.personaname : undefined,
    profileUrl: typeof player?.profileurl === "string" ? player.profileurl : undefined,
    owned: owned.data?.response,
    recent: recent.ok ? recent.data?.response?.games : undefined,
    limit,
  });
}
