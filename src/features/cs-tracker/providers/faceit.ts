import type { ProviderPartial } from "../dossier.js";
import { fetchJson } from "../http.js";

/**
 * FACEIT Data API — resolve Steam → FACEIT player, then pull game stats for cs2.
 * https://docs.faceit.com/
 */
export async function fetchFaceit(
  steamId64: string,
  apiKey: string | undefined,
): Promise<ProviderPartial> {
  if (!apiKey) return { provider: "faceit", status: "skipped" };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  try {
    const playerUrl =
      `https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${encodeURIComponent(steamId64)}`;
    const { ok, status, data } = await fetchJson<Record<string, unknown>>(playerUrl, { headers });
    if (!ok || !data) {
      // Try csgo game id as fallback for older accounts
      const alt = await fetchJson<Record<string, unknown>>(
        `https://open.faceit.com/data/v4/players?game=csgo&game_player_id=${encodeURIComponent(steamId64)}`,
        { headers },
      );
      if (!alt.ok || !alt.data) {
        return {
          provider: "faceit",
          status: "error",
          error: `FACEIT player lookup failed (${status})`,
        };
      }
      return mapFaceitPlayer(alt.data);
    }
    return mapFaceitPlayer(data);
  } catch (err) {
    return {
      provider: "faceit",
      status: "error",
      error: `FACEIT error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function mapFaceitPlayer(data: Record<string, unknown>): ProviderPartial {
  const games = (data.games && typeof data.games === "object" ? data.games : {}) as Record<
    string,
    Record<string, unknown>
  >;
  const cs2 = games.cs2 ?? games.csgo ?? {};
  const nickname = typeof data.nickname === "string" ? data.nickname : undefined;
  const playerId = typeof data.player_id === "string" ? data.player_id : undefined;

  return {
    provider: "faceit",
    status: "ok",
    timestamp: new Date().toISOString(),
    identity: {
      personaName: nickname,
      avatarUrl: typeof data.avatar === "string" ? data.avatar : undefined,
      country: typeof data.country === "string" ? data.country : undefined,
    },
    faceit: {
      level: num(cs2.skill_level),
      elo: num(cs2.faceit_elo),
      nickname,
      url: nickname ? `https://www.faceit.com/en/players/${nickname}` : undefined,
      stats: {
        player_id: playerId,
        region: cs2.region,
        game_player_name: cs2.game_player_name,
      },
    },
    links: {
      faceit: nickname ? `https://www.faceit.com/en/players/${nickname}` : undefined,
    },
    raw: data,
  };
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
