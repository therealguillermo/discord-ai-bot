import type { ProviderPartial } from "../dossier.js";
import { fetchJson } from "../http.js";

const API = "https://csrep.gg/api";

export type CsrepMatchSource = "csrep" | "faceit" | "gamersclub";

export type CsrepClient = {
  getPlayer: (steamId64: string) => Promise<ProviderPartial>;
  getPlayers: (steamIds: string[]) => Promise<ProviderPartial[]>;
  search: (query: string) => Promise<{ steamId64: string; name?: string }[]>;
  refresh: (steamId64: string) => Promise<{ ok: boolean; status: number; data: unknown }>;
  getMatch: (source: CsrepMatchSource, id: string) => Promise<unknown>;
  importShareCode: (shareCode: string) => Promise<unknown>;
  importFaceit: (params: { url?: string; matchId?: string }) => Promise<unknown>;
};

/** `{ status, result }` envelope from the CSRep API. A bare payload is returned as-is. */
export function csrepResult<T>(payload: unknown): { ok: true; result: T } | { ok: false; error: string } {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (record.status === "ERROR") {
      const message = record.message ?? record.error ?? record.detail;
      return { ok: false, error: typeof message === "string" && message.trim() ? message.trim() : "CSRep returned ERROR" };
    }
    if ("result" in record) return { ok: true, result: record.result as T };
  }
  return { ok: true, result: payload as T };
}

export function csrepMatchPath(source: CsrepMatchSource, id: string): string {
  const encoded = encodeURIComponent(id);
  if (source === "faceit") return `/matches/faceit/${encoded}`;
  if (source === "gamersclub") return `/matches/gamersclub/${encoded}`;
  return `/matches/${encoded}`;
}

export function createCsrepClient(apiKey: string | undefined): CsrepClient | null {
  if (!apiKey) return null;
  const headers = { "X-API-Key": apiKey, Accept: "application/json" };

  async function call<T>(
    path: string,
    opts: { method?: string; body?: string } = {},
  ): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
    const res = await fetchJson<unknown>(`${API}${path}`, { headers, ...opts });
    const parsed = csrepResult<T>(res.data);
    if (!res.ok || !parsed.ok) {
      const detail = !parsed.ok ? parsed.error : res.text.slice(0, 200);
      return { ok: false, error: `CSRep ${res.status}${detail ? `: ${detail}` : ""}` };
    }
    return parsed;
  }

  async function getPlayer(steamId64: string): Promise<ProviderPartial> {
    const got = await call<Record<string, unknown>>(`/players/${encodeURIComponent(steamId64)}`);
    if (!got.ok || !got.result || typeof got.result !== "object" || Array.isArray(got.result)) {
      return {
        provider: "csrep",
        status: "error",
        error: got.ok ? `CSRep player ${steamId64} returned an empty result` : got.error,
        raw: { steamId64 },
      };
    }
    return mapCsrepPlayer(got.result);
  }

  async function getPlayers(steamIds: string[]): Promise<ProviderPartial[]> {
    if (steamIds.length === 0) return [];
    if (steamIds.length === 1) return [await getPlayer(steamIds[0]!)];
    const got = await call<unknown>(`/players?ids=${steamIds.map(encodeURIComponent).join(",")}`);
    if (!got.ok) {
      return steamIds.map((id) => ({
        provider: "csrep" as const,
        status: "error" as const,
        error: got.error,
        raw: { steamId64: id },
      }));
    }
    const list = playerList(got.result);
    if (!list) return Promise.all(steamIds.map((id) => getPlayer(id)));
    return list.map((p) => mapCsrepPlayer(p));
  }

  async function search(query: string): Promise<{ steamId64: string; name?: string }[]> {
    const got = await call<unknown>(`/players/search?query=${encodeURIComponent(query)}`);
    if (!got.ok || got.result == null) return [];
    const list = playerList(got.result) ?? [];
    const out: { steamId64: string; name?: string }[] = [];
    for (const item of list) {
      const o = item as Record<string, unknown>;
      const id = String(o.steamId ?? o.steamid ?? o.steam_id ?? o.id ?? "");
      if (!/^7656119\d{10}$/.test(id)) continue;
      out.push({
        steamId64: id,
        name: typeof o.name === "string" ? o.name
          : typeof o.personaName === "string" ? o.personaName
            : typeof o.username === "string" ? o.username
              : undefined,
      });
    }
    return out;
  }

  async function refresh(steamId64: string) {
    return fetchJson(`${API}/players/${encodeURIComponent(steamId64)}/refresh`, {
      headers,
      method: "POST",
    });
  }

  async function getMatch(source: CsrepMatchSource, id: string): Promise<unknown> {
    const got = await call<unknown>(csrepMatchPath(source, id));
    if (!got.ok) throw new Error(got.error);
    return got.result;
  }

  async function importShareCode(shareCode: string): Promise<unknown> {
    const got = await call<unknown>("/matches/import", {
      method: "POST",
      body: JSON.stringify({ share_code: shareCode }),
    });
    if (!got.ok) throw new Error(got.error);
    return got.result;
  }

  async function importFaceit(params: { url?: string; matchId?: string }): Promise<unknown> {
    const body: Record<string, string> = {};
    if (params.url) body.url = params.url;
    if (params.matchId) body.match_id = params.matchId;
    const got = await call<unknown>("/matches/import/faceit", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!got.ok) throw new Error(got.error);
    return got.result;
  }

  return { getPlayer, getPlayers, search, refresh, getMatch, importShareCode, importFaceit };
}

function playerList(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) return data.filter(isRecord);
  const obj = asObj(data);
  if (!obj) return null;
  if (Array.isArray(obj.players)) return obj.players.filter(isRecord);
  if (Array.isArray(obj.results)) return obj.results.filter(isRecord);
  return null;
}

export function mapCsrepPlayer(data: Record<string, unknown>): ProviderPartial {
  const steamId = String(data.id ?? data.steamId ?? data.steamid ?? data.steam_id ?? "");
  const faceit = asObj(data.faceit ?? data.faceIt);
  const trust = asObj(data.trust ?? data.reputation ?? data.trustRating);
  const faceitUrl = str(data.faceit_url ?? faceit?.url ?? faceit?.profile);
  const premier = num(data.premierRating ?? data.premier ?? data.cs2Premier ?? asObj(data.cs2)?.premier)
    ?? rankCurrent(data.ranks, /premier/i);

  return {
    provider: "csrep",
    status: "ok",
    timestamp: str(data.refreshed_at ?? data.updated_at ?? data.updatedAt ?? data.refreshedAt ?? data.lastRefresh)
      ?? new Date().toISOString(),
    identity: {
      personaName: str(data.name ?? data.personaName ?? data.username ?? data.personaname),
      avatarUrl: str(data.avatar ?? data.avatarUrl ?? data.avatarfull),
      profileUrl: /^7656119\d{10}$/.test(steamId) ? `https://steamcommunity.com/profiles/${steamId}` : undefined,
      country: str(data.country ?? data.loccountrycode),
    },
    cs2: {
      hours: num(data.cs2_hours ?? data.cs2Hours ?? data.hours ?? asObj(data.cs2)?.hours),
      premierRating: premier,
      wins: num(data.wins ?? asObj(data.cs2)?.wins),
    },
    faceit: {
      level: num(faceit?.level ?? faceit?.skill_level ?? data.faceitLevel) ?? rankCurrent(data.ranks, /faceit/i),
      elo: num(faceit?.elo ?? faceit?.faceit_elo ?? data.faceitElo),
      nickname: str(faceit?.nickname ?? faceit?.username) ?? faceitNickname(faceitUrl),
      url: faceitUrl,
    },
    trust: {
      score: num(trust?.trust_score ?? trust?.score ?? trust?.rating ?? data.trustScore ?? data.trust_rating),
      flags: arrStr(trust?.flags ?? data.flags) ?? autoflagNote(data.autoflag),
      notes: data.redacted === true ? "Profile is redacted on CSRep." : str(trust?.notes ?? trust?.summary),
    },
    bans: mapBans(data),
    links: {
      csrep: /^7656119\d{10}$/.test(steamId) ? `https://csrep.gg/player/${steamId}` : undefined,
      faceit: faceitUrl,
    },
    raw: data,
  };
}

function mapBans(data: Record<string, unknown>): ProviderPartial["bans"] {
  if (Array.isArray(data.bans)) {
    const types = data.bans
      .map((ban) => str(asObj(ban)?.type)?.toUpperCase())
      .filter((t): t is string => Boolean(t));
    return {
      vac: types.includes("VAC"),
      gameBan: types.includes("GAME"),
      community: types.includes("COMMUNITY"),
      numberOfBans: data.bans.length,
    };
  }
  const bans = asObj(data.bans ?? data.ban);
  return {
    vac: bool(bans?.vac ?? bans?.VACBanned ?? data.vacBanned),
    gameBan: bool(bans?.gameBan ?? bans?.NumberOfGameBans ?? data.gameBan),
    community: bool(bans?.community ?? data.communityBanned),
    numberOfBans: num(bans?.numberOfBans ?? bans?.NumberOfVACBans),
    daysSinceLastBan: num(bans?.daysSinceLastBan ?? bans?.DaysSinceLastBan),
  };
}

function rankCurrent(ranks: unknown, key: RegExp): number | undefined {
  const obj = asObj(ranks);
  if (!obj) return undefined;
  for (const [name, value] of Object.entries(obj)) {
    if (!key.test(name)) continue;
    const row = asObj(value);
    return num(row?.current ?? value);
  }
  return undefined;
}

function faceitNickname(url: string | undefined): string | undefined {
  const match = url?.match(/faceit\.com\/(?:[a-z]{2}\/)?players\/([A-Za-z0-9_-]+)/i);
  return match?.[1];
}

function autoflagNote(autoflag: unknown): string[] | undefined {
  const row = asObj(autoflag);
  if (!row?.id) return undefined;
  return ["autoflag"];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === "boolean") return undefined;
  return undefined;
}
function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    if (/^(true|yes|1)$/i.test(v)) return true;
    if (/^(false|no|0)$/i.test(v)) return false;
  }
  return undefined;
}
function arrStr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => String(x)).filter(Boolean);
  return out.length ? out : undefined;
}
