import type { PlayerDossier, ProviderPartial } from "../dossier.js";
import { fetchText } from "../http.js";
import {
  applyFaceitHistory,
  csstRejectReason,
  csstSectionNames,
  faceitHistoryPaths,
  linksFromHtml,
  parseCsstProfile,
  type CsstProfile,
} from "./csstParse.js";

export { linksFromHtml };

/**
 * CSST.at has no public API the bot can rely on. Profile pages load HTMX
 * fragments. A client that has not passed Cloudflare is either challenged or
 * handed placeholder stats, and those placeholders are thrown away.
 */
export async function fetchCsst(
  steamId64: string,
  opts: { apiKey?: string; enabled: boolean },
): Promise<ProviderPartial> {
  if (!opts.enabled) return { provider: "csst", status: "skipped" };

  if (opts.apiKey) {
    const jsonTry = await tryOfficialApi(steamId64, opts.apiKey);
    if (jsonTry) return jsonTry;
  }

  try {
    const headers = { "HX-Request": "true", Accept: "text/html" };
    const results = await Promise.all(
      csstSectionNames().map(async (section) => {
        const { ok, status, text } = await fetchText(`https://csst.at/${steamId64}/${section}`, { headers });
        return { section, ok, status, text };
      }),
    );

    const parts: Record<string, string> = {};
    const failed: string[] = [];
    for (const result of results) {
      if (!result.ok) {
        failed.push(`${result.section} (${result.status})`);
        continue;
      }
      parts[result.section] = result.text;
    }

    if (!Object.keys(parts).length) {
      return {
        provider: "csst",
        status: "error",
        error: `CSST failed (${failed[0] ?? "no sections"}). Stats were not read.`,
      };
    }

    if (parts.faceit) {
      let faceitHtml = parts.faceit;
      for (const path of faceitHistoryPaths(faceitHtml)) {
        const game = path.match(/game_id=([a-z0-9]+)/i)?.[1];
        const { ok, text } = await fetchText(`https://csst.at${path}`, { headers });
        if (!ok || !game) continue;
        faceitHtml = applyFaceitHistory(faceitHtml, game, text);
      }
      parts.faceit = faceitHtml;
    }

    const combined = Object.values(parts).join("\n");
    const rejected = csstRejectReason(combined);
    if (rejected) {
      return {
        provider: "csst",
        status: "error",
        error: `CSST did not return this player (${rejected}). Stats were not read.`,
      };
    }

    const profile = parseCsstProfile(steamId64, parts);
    return partialFromProfile(profile, failed);
  } catch (err) {
    return {
      provider: "csst",
      status: "error",
      error: `CSST error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function partialFromProfile(profile: CsstProfile, failed: string[]): ProviderPartial {
  const cs2Game = profile.faceit?.games.cs2;
  const elo = leadingNumber(cs2Game?.fields.ELO);
  const level = leadingNumber(cs2Game?.fields.Level);
  const premier = numericRank(profile.leetify?.ranks?.find((rank) => rank.mode === "Premier")?.rank);
  const hours = hoursOf(profile.steam?.fields["CS2 Playtime"]);
  const trust = leadingNumber(profile.cstracker?.trust);

  return {
    provider: "csst",
    status: "ok",
    timestamp: new Date().toISOString(),
    identity: {
      personaName: profile.steam?.name,
      avatarUrl: profile.steam?.avatarUrl,
      profileUrl: profile.steam?.url,
      country: profile.steam?.fields.Country,
    },
    cs2: {
      hours,
      premierRating: premier,
      gc: defined({
        medals: profile.medals,
        xpLevel: profile.steam?.fields["XP level"],
        commendations: profile.steam?.fields.Commendations,
        steamLevel: profile.steam?.level,
      }),
    },
    faceit: {
      level,
      elo,
      nickname: faceitNickname(profile.faceit?.url) ?? profile.faceit?.name,
      url: profile.faceit?.url,
      stats: profile.faceit
        ? {
            registered: profile.faceit.fields.Registered,
            country: profile.faceit.fields.Country,
            csgo: profile.faceit.games.csgo?.fields,
            cs2: cs2Game?.fields,
            notes: { ...profile.faceit.notes, ...cs2Game?.notes },
          }
        : undefined,
    },
    leetify: {
      rating: leadingNumber(profile.leetify?.fields.Rating),
      url: profile.leetify?.url,
      ranks: profile.leetify
        ? {
            name: profile.leetify.name,
            fields: profile.leetify.fields,
            notes: profile.leetify.notes,
            rows: profile.leetify.ranks,
          }
        : undefined,
    },
    trust: trust !== undefined ? { score: trust } : undefined,
    links: {
      csst: profile.url,
      ...profile.links,
    },
    raw: {
      profile,
      ...(failed.length ? { sectionErrors: failed } : {}),
    },
  };
}

async function tryOfficialApi(steamId64: string, apiKey: string): Promise<ProviderPartial | null> {
  try {
    const { ok, text } = await fetchText(`https://csst.at/api/players/${steamId64}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!ok) return null;
    const data = JSON.parse(text) as Record<string, unknown>;
    return {
      provider: "csst",
      status: "ok",
      identity: {
        personaName: typeof data.name === "string" ? data.name : undefined,
        avatarUrl: typeof data.avatar === "string" ? data.avatar : undefined,
      },
      links: { csst: `https://csst.at/profile/${steamId64}` },
      raw: data,
    };
  } catch {
    return null;
  }
}

function leadingNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/,/g, "").match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}

function faceitNickname(url: string | undefined): string | undefined {
  return url?.match(/faceit\.com\/(?:[a-z]{2}\/)?players\/([^/?#]+)/i)?.[1];
}

function hoursOf(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const total = value.match(/total:\s*([\d,.]+)\s*h/i)?.[1] ?? value.match(/([\d,.]+)\s*h/i)?.[1];
  if (!total) return undefined;
  const n = Number(total.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function defined(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function numericRank(value: string | undefined): number | undefined {
  if (!value || value.trim() === "?") return undefined;
  return leadingNumber(value);
}
