import type { ProviderPartial } from "../dossier.js";
import { fetchText, htmlNearNumber, stripTags } from "../http.js";

const SECTIONS = ["steam", "faceit", "leetify", "game-coordinator", "links"] as const;

/**
 * CSST.at has no public API; profile pages load HTMX fragments.
 * When CSST_API_KEY is present we try a conventional JSON path first, then fragments.
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
    const headers = {
      "HX-Request": "true",
      Accept: "text/html",
    };
    const results = await Promise.all(
      SECTIONS.map(async (section) => {
        const { ok, status, text } = await fetchText(`https://csst.at/${steamId64}/${section}`, {
          headers,
        });
        return { section, ok, status, text };
      }),
    );

    const failed = results.filter((r) => !r.ok);
    if (failed.length === SECTIONS.length) {
      // Fallback: full profile page
      const page = await fetchText(`https://csst.at/profile/${steamId64}`);
      if (!page.ok) {
        return {
          provider: "csst",
          status: "error",
          error: `CSST failed (${failed[0]?.status ?? page.status})`,
        };
      }
      return parseCombined(steamId64, page.text, { profile: page.text });
    }

    const parts: Record<string, string> = {};
    for (const r of results) {
      if (r.ok) parts[r.section] = r.text;
    }
    return parseCombined(steamId64, Object.values(parts).join("\n"), parts);
  } catch (err) {
    return {
      provider: "csst",
      status: "error",
      error: `CSST error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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

function parseCombined(
  steamId64: string,
  combined: string,
  parts: Record<string, string>,
): ProviderPartial {
  const faceitHtml = parts.faceit ?? combined;
  const leetifyHtml = parts.leetify ?? combined;
  const steamHtml = parts.steam ?? combined;
  const gcHtml = parts["game-coordinator"] ?? "";

  const faceitLevel = htmlNearNumber(faceitHtml, /level|skill\s*level/i);
  const faceitElo = htmlNearNumber(faceitHtml, /elo|rating/i);
  const leetifyRating = htmlNearNumber(leetifyHtml, /leetify|rating/i);
  const hours = htmlNearNumber(steamHtml, /hours?|playtime/i);
  const premier = htmlNearNumber(combined, /premier/i);

  const nicknameMatch = faceitHtml.match(/faceit\.com\/(?:players|en\/players)\/([A-Za-z0-9_-]+)/i);
  const leetifyUrl = combined.match(/https?:\/\/[^\s"'<>]*leetify[^\s"'<>]*/i)?.[0];

  return {
    provider: "csst",
    status: "ok",
    timestamp: new Date().toISOString(),
    identity: {
      personaName: guessName(steamHtml) ?? guessName(combined),
    },
    cs2: {
      hours,
      premierRating: premier,
      gc: gcHtml ? { text: stripTags(gcHtml).slice(0, 1500) } : undefined,
    },
    faceit: {
      level: faceitLevel,
      elo: faceitElo,
      nickname: nicknameMatch?.[1],
      url: nicknameMatch?.[1] ? `https://www.faceit.com/en/players/${nicknameMatch[1]}` : undefined,
      stats: parts.faceit ? { text: stripTags(parts.faceit).slice(0, 1500) } : undefined,
    },
    leetify: {
      rating: leetifyRating,
      url: leetifyUrl,
      ranks: parts.leetify ? { text: stripTags(parts.leetify).slice(0, 1500) } : undefined,
    },
    links: {
      csst: `https://csst.at/profile/${steamId64}`,
      leetify: leetifyUrl,
      faceit: nicknameMatch?.[1] ? `https://www.faceit.com/en/players/${nicknameMatch[1]}` : undefined,
    },
    raw: {
      sections: Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, stripTags(v).slice(0, 2000)]),
      ),
    },
  };
}

function guessName(html: string): string | undefined {
  const t = stripTags(html);
  const m = t.match(/^([A-Za-z0-9 _.\-]{2,32})/);
  return m?.[1]?.trim();
}
