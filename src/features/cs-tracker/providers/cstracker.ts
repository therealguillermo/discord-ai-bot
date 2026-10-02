import type { ProviderPartial } from "../dossier.js";
import { fetchText, htmlMeta, htmlNearNumber, stripTags } from "../http.js";

export async function fetchCstracker(
  steamId64: string,
  opts: { enabled: boolean },
): Promise<ProviderPartial> {
  if (!opts.enabled) return { provider: "cstracker", status: "skipped" };

  try {
    const { ok, status, text } = await fetchText(`https://cstracker.gg/players/${steamId64}`);
    if (!ok) {
      return {
        provider: "cstracker",
        status: "error",
        error: `CSTracker profile failed (${status})`,
      };
    }

    const title = htmlMeta(text, "og:title") ?? htmlMeta(text, "twitter:title");
    const desc = htmlMeta(text, "og:description") ?? htmlMeta(text, "description");
    const image = htmlMeta(text, "og:image");
    const plain = stripTags(text).slice(0, 3000);

    return {
      provider: "cstracker",
      status: "ok",
      timestamp: new Date().toISOString(),
      identity: {
        personaName: title?.replace(/\s*[|\-–].*$/, "").trim() || undefined,
        avatarUrl: image,
        profileUrl: `https://cstracker.gg/players/${steamId64}`,
      },
      cs2: {
        premierRating: htmlNearNumber(text, /premier/i),
        hours: htmlNearNumber(text, /hours?/i),
        wins: htmlNearNumber(text, /wins?/i),
      },
      faceit: {
        level: htmlNearNumber(text, /faceit\s*level|skill\s*level/i),
        elo: htmlNearNumber(text, /faceit\s*elo|\belo\b/i),
      },
      tracker: {
        description: desc,
        excerpt: plain.slice(0, 1200),
      },
      links: {
        cstracker: `https://cstracker.gg/players/${steamId64}`,
      },
      raw: { excerpt: plain.slice(0, 2000) },
    };
  } catch (err) {
    return {
      provider: "cstracker",
      status: "error",
      error: `CSTracker error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type LeaderboardRow = {
  rank?: number;
  name?: string;
  steamId64?: string;
  value?: string;
  raw: string;
};

export async function fetchCstrackerLeaderboard(opts: {
  enabled: boolean;
  limit?: number;
}): Promise<{ ok: boolean; error?: string; rows: LeaderboardRow[]; sourceUrl: string }> {
  const sourceUrl = "https://cstracker.gg/leaderboards";
  if (!opts.enabled) {
    return { ok: false, error: "CSTracker is disabled (CSTRACKER_ENABLED=false).", rows: [], sourceUrl };
  }

  try {
    const { ok, status, text } = await fetchText(sourceUrl);
    if (!ok) {
      return { ok: false, error: `CSTracker leaderboards failed (${status})`, rows: [], sourceUrl };
    }

    const rows: LeaderboardRow[] = [];
    // Rows that look like ranking lines or profile links
    const profileRe = /\/players\/(7656119\d{10})/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = profileRe.exec(text)) !== null) {
      const id = m[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      const window = text.slice(Math.max(0, m.index - 120), m.index + 180);
      const name = stripTags(window).match(/([A-Za-z0-9 _.\-]{2,32})/)?.[1];
      rows.push({
        rank: rows.length + 1,
        steamId64: id,
        name: name?.trim(),
        raw: stripTags(window).slice(0, 200),
      });
      if (rows.length >= (opts.limit ?? 25)) break;
    }

    // If no profile links, fall back to numbered lines from stripped text
    if (rows.length === 0) {
      const plain = stripTags(text);
      const lineRe = /^(\d{1,4})[).\s]+(.+)$/gm;
      let lm: RegExpExecArray | null;
      while ((lm = lineRe.exec(plain)) !== null) {
        rows.push({
          rank: Number(lm[1]),
          name: lm[2]?.trim().slice(0, 64),
          value: undefined,
          raw: lm[0].slice(0, 200),
        });
        if (rows.length >= (opts.limit ?? 25)) break;
      }
    }

    return { ok: true, rows, sourceUrl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      rows: [],
      sourceUrl,
    };
  }
}
