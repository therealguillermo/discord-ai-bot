import type { ProviderPartial } from "../dossier.js";
import { fetchJson } from "../http.js";

export async function fetchSteam(
  steamId64: string,
  apiKey: string | undefined,
): Promise<ProviderPartial> {
  if (!apiKey) return { provider: "steam", status: "skipped" };

  try {
    const summaryUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
    summaryUrl.searchParams.set("key", apiKey);
    summaryUrl.searchParams.set("steamids", steamId64);

    const bansUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/");
    bansUrl.searchParams.set("key", apiKey);
    bansUrl.searchParams.set("steamids", steamId64);

    const playUrl = new URL("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/");
    playUrl.searchParams.set("key", apiKey);
    playUrl.searchParams.set("steamid", steamId64);
    playUrl.searchParams.set("include_appinfo", "false");
    playUrl.searchParams.set("include_played_free_games", "true");
    playUrl.searchParams.set("appids_filter[0]", "730");

    const [summary, bans, games] = await Promise.all([
      fetchJson<{ response?: { players?: Record<string, unknown>[] } }>(summaryUrl.toString()),
      fetchJson<{ players?: Record<string, unknown>[] }>(bansUrl.toString()),
      fetchJson<{ response?: { games?: { appid: number; playtime_forever?: number }[] } }>(
        playUrl.toString(),
      ),
    ]);

    if (!summary.ok) {
      return {
        provider: "steam",
        status: "error",
        error: `Steam summaries failed (${summary.status})`,
      };
    }

    const player = summary.data?.response?.players?.[0];
    const ban = bans.data?.players?.[0];
    const cs2 = games.data?.response?.games?.find((g) => g.appid === 730);
    const minutes = cs2?.playtime_forever;

    return {
      provider: "steam",
      status: "ok",
      timestamp: new Date().toISOString(),
      identity: {
        personaName: typeof player?.personaname === "string" ? player.personaname : undefined,
        avatarUrl: typeof player?.avatarfull === "string" ? player.avatarfull : undefined,
        profileUrl:
          typeof player?.profileurl === "string"
            ? player.profileurl
            : `https://steamcommunity.com/profiles/${steamId64}`,
        country: typeof player?.loccountrycode === "string" ? player.loccountrycode : undefined,
      },
      cs2: {
        hours: typeof minutes === "number" ? Math.round(minutes / 60) : undefined,
      },
      bans: ban
        ? {
            vac: Boolean(ban.VACBanned),
            gameBan: Number(ban.NumberOfGameBans ?? 0) > 0,
            community: Boolean(ban.CommunityBanned),
            numberOfBans: Number(ban.NumberOfVACBans ?? 0) || undefined,
            daysSinceLastBan: Number(ban.DaysSinceLastBan ?? 0) || undefined,
          }
        : undefined,
      links: {
        steam:
          typeof player?.profileurl === "string"
            ? player.profileurl
            : `https://steamcommunity.com/profiles/${steamId64}`,
      },
      raw: { player, ban, cs2 },
    };
  } catch (err) {
    return {
      provider: "steam",
      status: "error",
      error: `Steam error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
