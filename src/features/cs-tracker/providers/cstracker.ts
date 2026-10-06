import type { ProviderPartial } from "../dossier.js";
import { fetchText, htmlMeta, htmlNearNumber, stripTags } from "../http.js";

const ORIGIN = "https://cstracker.gg";
const MAX_SECTIONS = 6;

/** FACEIT level and ELO from the profile header tooltip. */
export function cstrackerFaceit(html: string): { level?: number; elo?: number } {
  const title = html.match(/title="FACEIT level (\d+)[^"]*?([\d,]+)\s*ELO"/i);
  if (!title) return {};
  const level = Number(title[1]);
  const elo = Number(title[2]!.replace(/,/g, ""));
  return {
    level: Number.isFinite(level) ? level : undefined,
    elo: Number.isFinite(elo) ? elo : undefined,
  };
}

/** "trust rating 89.9 %" from the telemetry strip. */
export function cstrackerTrust(html: string): number | undefined {
  const match = stripTags(html).match(/trust rating\s+([0-9]+(?:\.[0-9]+)?)\s*%/i);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Same-origin hx-get targets on a CSTracker page. Other hosts and later pages are ignored. */
export function cstrackerSectionUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/hx-get=["']([^"']+)["']/gi)) {
    const raw = match[1]!.trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) continue;
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (url.origin !== ORIGIN) continue;
    const page = url.searchParams.get("page");
    if (page && page !== "1") continue;
    const key = `${url.pathname}${url.search}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url.toString());
    if (out.length >= MAX_SECTIONS) break;
  }
  return out;
}

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

    const pageUrl = `https://cstracker.gg/players/${steamId64}`;
    const sectionUrls = cstrackerSectionUrls(text, pageUrl);
    const sections = await Promise.all(
      sectionUrls.map(async (url) => {
        const res = await fetchText(url, { headers: { "HX-Request": "true", Accept: "text/html" } });
        return { url, ...res };
      }),
    );
    const extraHtml = sections.filter((s) => s.ok).map((s) => s.text).join("\n");
    const combined = extraHtml ? `${text}\n${extraHtml}` : text;
    const sectionText: Record<string, string> = {};
    for (const section of sections) {
      if (!section.ok) continue;
      const path = new URL(section.url).pathname + new URL(section.url).search;
      sectionText[path] = stripTags(section.text).slice(0, 800);
    }

    const labeled = cstrackerFaceit(text);
    const trust = cstrackerTrust(combined);
    const title = htmlMeta(text, "og:title") ?? htmlMeta(text, "twitter:title");
    const desc = htmlMeta(text, "og:description") ?? htmlMeta(text, "description");
    const image = htmlMeta(text, "og:image");
    const plain = stripTags(combined).slice(0, 3000);

    return {
      provider: "cstracker",
      status: "ok",
      timestamp: new Date().toISOString(),
      identity: {
        personaName: title?.replace(/\s*[|\-–].*$/, "").trim() || undefined,
        avatarUrl: image,
        profileUrl: pageUrl,
      },
      cs2: {
        premierRating: htmlNearNumber(combined, /premier/i),
        hours: htmlNearNumber(combined, /hours?/i),
        wins: htmlNearNumber(combined, /wins?/i),
      },
      faceit: {
        level: labeled.level ?? htmlNearNumber(combined, /faceit\s*level|skill\s*level/i),
        elo: labeled.elo ?? htmlNearNumber(combined, /faceit\s*elo|\belo\b/i),
      },
      trust: trust !== undefined ? { score: trust } : undefined,
      tracker: {
        description: desc,
        excerpt: plain.slice(0, 1200),
        ...(Object.keys(sectionText).length ? { sections: sectionText } : {}),
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
