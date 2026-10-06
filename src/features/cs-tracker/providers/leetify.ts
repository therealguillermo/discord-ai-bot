import type { ProviderPartial } from "../dossier.js";
import { fetchJson } from "../http.js";

/** Prod server from the Leetify public OpenAPI spec. */
export const LEETIFY_API = "https://api-public.cs-prod.leetify.com";

export type LeetifyPlayerQuery = { steam64Id?: string; leetifyId?: string };

export type LeetifyClient = {
  getProfile: (query: LeetifyPlayerQuery) => Promise<Record<string, unknown>>;
  getMatches: (query: LeetifyPlayerQuery) => Promise<unknown[]>;
  getMatch: (gameId: string) => Promise<Record<string, unknown>>;
  getMatchBySource: (dataSource: string, dataSourceId: string) => Promise<Record<string, unknown>>;
};

export function leetifyProfilePath(query: LeetifyPlayerQuery): string {
  return `/v3/profile?${playerQuery(query)}`;
}

export function leetifyMatchesPath(query: LeetifyPlayerQuery): string {
  return `/v3/profile/matches?${playerQuery(query)}`;
}

export function leetifyMatchPath(gameId: string): string {
  return `/v2/matches/${encodePathSegment(gameId, "game_id")}`;
}

export function leetifyMatchBySourcePath(dataSource: string, dataSourceId: string): string {
  if (!/^[a-z0-9_-]+$/i.test(dataSource.trim())) {
    throw new Error("data_source must be a single token such as matchmaking, faceit, or renown.");
  }
  return `/v2/matches/${encodePathSegment(dataSource, "data_source")}/${encodePathSegment(dataSourceId, "data_source_id")}`;
}

export function createLeetifyClient(apiKey: string | undefined): LeetifyClient {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  async function get(path: string): Promise<unknown> {
    const res = await fetchJson<unknown>(`${LEETIFY_API}${path}`, { headers });
    if (!res.ok || res.data == null) {
      const detail = res.text.replace(/\s+/g, " ").trim().slice(0, 180);
      throw new Error(`Leetify ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.data;
  }

  return {
    async getProfile(query) {
      const data = await get(leetifyProfilePath(query));
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Leetify profile response was not an object.");
      }
      return data as Record<string, unknown>;
    },
    async getMatches(query) {
      const data = await get(leetifyMatchesPath(query));
      if (!Array.isArray(data)) throw new Error("Leetify match history response was not an array.");
      return data;
    },
    async getMatch(gameId) {
      const data = await get(leetifyMatchPath(gameId));
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Leetify match response was not an object.");
      }
      return data as Record<string, unknown>;
    },
    async getMatchBySource(dataSource, dataSourceId) {
      const data = await get(leetifyMatchBySourcePath(dataSource, dataSourceId));
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Leetify match response was not an object.");
      }
      return data as Record<string, unknown>;
    },
  };
}

export async function fetchLeetifyProfile(
  steamId64: string,
  client: LeetifyClient | null,
): Promise<ProviderPartial> {
  if (!client) return { provider: "leetify", status: "skipped" };
  try {
    const data = await client.getProfile({ steam64Id: steamId64 });
    return mapLeetifyProfile(data, steamId64);
  } catch (err) {
    return {
      provider: "leetify",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Map a profile payload onto dossier fields without renaming or rescaling API numbers. */
export function mapLeetifyProfile(data: Record<string, unknown>, steamId64: string): ProviderPartial {
  const ranks = asRecord(data.ranks);
  const steam = steamId(data.steam64_id) ?? steamId(steamId64);
  const url = steam ? `https://leetify.com/app/profile/${steam}` : undefined;
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;
  const summaryRanks = summaryRankFields(ranks);
  const premier = num(ranks.premier);
  const faceitLevel = num(ranks.faceit);
  const faceitElo = num(ranks.faceit_elo);

  return {
    provider: "leetify",
    status: "ok",
    timestamp: new Date().toISOString(),
    identity: name ? { personaName: name } : undefined,
    cs2: premier != null ? { premierRating: premier } : undefined,
    faceit:
      faceitLevel != null || faceitElo != null
        ? { level: faceitLevel, elo: faceitElo }
        : undefined,
    leetify: {
      rating: num(ranks.leetify),
      url,
      ranks: Object.keys(summaryRanks).length ? summaryRanks : undefined,
    },
    links: url ? { leetify: url } : undefined,
    raw: data,
  };
}

function playerQuery(query: LeetifyPlayerQuery): string {
  const steam = query.steam64Id?.trim() ?? "";
  const id = query.leetifyId?.trim() ?? "";
  if (steam && id) throw new Error("Pass steam64_id or Leetify id, not both.");
  if (steam) {
    if (!steamId(steam)) throw new Error("steam64_id must be a SteamID64.");
    return `steam64_id=${encodeURIComponent(steam)}`;
  }
  if (id) return `id=${encodePathSegment(id, "leetify_id")}`;
  throw new Error("steam64_id or Leetify id is required.");
}

function encodePathSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\\/]/.test(trimmed)) throw new Error(`${label} must be a single path segment.`);
  return encodeURIComponent(trimmed);
}

function summaryRankFields(ranks: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["leetify", "premier", "faceit", "faceit_elo", "wingman", "renown"] as const) {
    const n = num(ranks[key]);
    if (n != null) out[key] = n;
  }
  if (Array.isArray(ranks.competitive)) out.competitive = ranks.competitive;
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function steamId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  return /^7656119\d{10}$/.test(id) ? id : undefined;
}
