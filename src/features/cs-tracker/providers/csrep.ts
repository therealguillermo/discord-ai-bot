import type { ProviderPartial } from "../dossier.js";
import { fetchJson } from "../http.js";

export type CsrepClient = {
  getPlayer: (steamId64: string) => Promise<ProviderPartial>;
  getPlayers: (steamIds: string[]) => Promise<ProviderPartial[]>;
  search: (query: string) => Promise<{ steamId64: string; name?: string }[]>;
  refresh: (steamId64: string) => Promise<{ ok: boolean; status: number; data: unknown }>;
};

export function createCsrepClient(apiKey: string | undefined): CsrepClient | null {
  if (!apiKey) return null;
  const headers = { "x-api-key": apiKey, Accept: "application/json" };

  async function getPlayer(steamId64: string): Promise<ProviderPartial> {
    const { ok, status, data, text } = await fetchJson<Record<string, unknown>>(
      `https://csrep.gg/api/players/${steamId64}`,
      { headers },
    );
    if (!ok || !data) {
      return {
        provider: "csrep",
        status: "error",
        error: `CSRep player ${steamId64} failed (${status}): ${text.slice(0, 200)}`,
      };
    }
    return mapPlayer(data);
  }

  async function getPlayers(steamIds: string[]): Promise<ProviderPartial[]> {
    if (steamIds.length === 0) return [];
    if (steamIds.length === 1) return [await getPlayer(steamIds[0]!)];
    const url = `https://csrep.gg/api/players?ids=${steamIds.map(encodeURIComponent).join(",")}`;
    const { ok, status, data, text } = await fetchJson<unknown>(url, { headers });
    if (!ok || data == null) {
      return steamIds.map((id) => ({
        provider: "csrep" as const,
        status: "error" as const,
        error: `CSRep batch failed (${status}): ${text.slice(0, 200)}`,
        raw: { steamId64: id },
      }));
    }
    const list = Array.isArray(data) ? data : (data as { players?: unknown[] }).players;
    if (!Array.isArray(list)) {
      // Fall back to sequential
      return Promise.all(steamIds.map((id) => getPlayer(id)));
    }
    return list.map((p) => mapPlayer(p as Record<string, unknown>));
  }

  async function search(query: string): Promise<{ steamId64: string; name?: string }[]> {
    const url = `https://csrep.gg/api/players/search?query=${encodeURIComponent(query)}`;
    const { ok, data } = await fetchJson<unknown>(url, { headers });
    if (!ok || data == null) return [];
    const list = Array.isArray(data) ? data : (data as { results?: unknown[]; players?: unknown[] }).results
      ?? (data as { players?: unknown[] }).players
      ?? [];
    if (!Array.isArray(list)) return [];
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
    return fetchJson(`https://csrep.gg/api/players/${steamId64}/refresh`, {
      headers,
      method: "POST",
    });
  }

  return { getPlayer, getPlayers, search, refresh };
}

function mapPlayer(data: Record<string, unknown>): ProviderPartial {
  const steamId = String(data.steamId ?? data.steamid ?? data.steam_id ?? "");
  const faceit = asObj(data.faceit ?? data.faceIt);
  const trust = asObj(data.trust ?? data.reputation ?? data.trustRating);
  const bans = asObj(data.bans ?? data.ban);
  const premier = num(data.premierRating ?? data.premier ?? data.cs2Premier ?? asObj(data.cs2)?.premier);

  return {
    provider: "csrep",
    status: "ok",
    timestamp: str(data.updatedAt ?? data.refreshedAt ?? data.lastRefresh) ?? new Date().toISOString(),
    identity: {
      personaName: str(data.name ?? data.personaName ?? data.username ?? data.personaname),
      avatarUrl: str(data.avatar ?? data.avatarUrl ?? data.avatarfull),
      profileUrl: steamId ? `https://steamcommunity.com/profiles/${steamId}` : undefined,
      country: str(data.country ?? data.loccountrycode),
    },
    cs2: {
      hours: num(data.cs2Hours ?? data.hours ?? asObj(data.cs2)?.hours),
      premierRating: premier,
      wins: num(data.wins ?? asObj(data.cs2)?.wins),
    },
    faceit: {
      level: num(faceit?.level ?? faceit?.skill_level ?? data.faceitLevel),
      elo: num(faceit?.elo ?? faceit?.faceit_elo ?? data.faceitElo),
      nickname: str(faceit?.nickname ?? faceit?.username),
      url: str(faceit?.url ?? faceit?.profile),
    },
    trust: {
      score: num(trust?.score ?? trust?.rating ?? data.trustScore ?? data.trust_rating),
      flags: arrStr(trust?.flags ?? data.flags),
      notes: str(trust?.notes ?? trust?.summary),
    },
    bans: {
      vac: bool(bans?.vac ?? bans?.VACBanned ?? data.vacBanned),
      gameBan: bool(bans?.gameBan ?? bans?.NumberOfGameBans ?? data.gameBan),
      community: bool(bans?.community ?? data.communityBanned),
      numberOfBans: num(bans?.numberOfBans ?? bans?.NumberOfVACBans),
      daysSinceLastBan: num(bans?.daysSinceLastBan ?? bans?.DaysSinceLastBan),
    },
    links: {
      csrep: steamId ? `https://csrep.gg/player/${steamId}` : undefined,
      faceit: str(faceit?.url),
    },
    raw: data,
  };
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
