import type { PlayerDossier } from "../dossier.js";

/** One labeled card. Keys are the site's own labels ("Peak ELO", "CS2 Playtime"). */
export type CsstCard = {
  name?: string;
  url?: string;
  fields: Record<string, string>;
  /** Long tooltips, keyed by the same label (suspicion notes, rank breakdowns). */
  notes?: Record<string, string>;
};

export type CsstMatch = Record<string, string>;

export type CsstProfile = {
  steamId64: string;
  url: string;
  steam?: CsstCard & { level?: string; avatarUrl?: string };
  faceit?: CsstCard & {
    games: Record<string, CsstCard>;
  };
  leetify?: CsstCard & { ranks?: { mode: string; rank: string }[] };
  scope?: CsstCard & { weapons?: Record<string, Record<string, string>> };
  cstracker?: CsstCard & {
    trust?: string;
    factors?: { label: string; delta: string }[];
    matches?: CsstMatch[];
  };
  csstats?: CsstCard & { matches?: CsstMatch[] };
  inventory?: {
    value?: string;
    items?: { name: string; price?: string; wear?: string; url?: string }[];
  };
  medals?: string[];
  links?: Partial<PlayerDossier["links"]>;
};

const SECTIONS = [
  "steam",
  "faceit",
  "leetify",
  "leetify-extra",
  "scopegg",
  "cstracker",
  "links",
  "game-coordinator",
  "csxp",
  "csstatsgg",
  "inventory",
] as const;

export type CsstSectionName = (typeof SECTIONS)[number];

export function csstSectionNames(): readonly CsstSectionName[] {
  return SECTIONS;
}

/**
 * csst.at answers some clients with a real-looking page whose clock times are
 * stamped onto unrelated dates. Those numbers are not the player. A Cloudflare
 * interstitial is the other failure. Either one must be discarded.
 */
export function csstRejectReason(html: string): string | undefined {
  if (/performing security verification|just a moment|cf-challenge|enable javascript and cookies to continue/i.test(html)) {
    return "Cloudflare challenge";
  }
  const clocks = new Map<string, Set<string>>();
  for (const match of html.matchAll(/datetime="([^"]+)"/gi)) {
    const stamp = match[1]!;
    const clock = stamp.match(/T(\d{2}:\d{2}:\d{2})/)?.[1];
    const day = stamp.slice(0, 10);
    if (!clock || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const days = clocks.get(clock) ?? new Set<string>();
    days.add(day);
    clocks.set(clock, days);
  }
  for (const [clock, days] of clocks) {
    if (days.size >= 2) return `placeholder timestamps all using ${clock}`;
  }
  return undefined;
}

export function parseCsstProfile(steamId64: string, parts: Record<string, string>): CsstProfile {
  const steamHtml = [parts.steam, parts["game-coordinator"]].filter(Boolean).join("\n");
  const faceitHtml = parts.faceit ?? "";
  const leetifyHtml = [parts.leetify, parts["leetify-extra"]].filter(Boolean).join("\n");
  const scopeHtml = parts.scopegg ?? "";
  const trackerHtml = parts.cstracker ?? "";
  const csstatsHtml = parts.csstatsgg ?? "";
  const inventoryHtml = parts.inventory ?? "";
  const linksHtml = parts.links ?? "";

  const profile: CsstProfile = {
    steamId64,
    url: `https://csst.at/profile/${steamId64}`,
  };

  if (steamHtml.trim()) {
    const card = cardFrom(steamHtml);
    const level = textOf(steamHtml.match(/friendPlayerLevel[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const avatar = steamHtml.match(/https?:\/\/avatars\.steamstatic\.com\/[^"'\s]+/i)?.[0];
    profile.steam = { ...card, level: level || undefined, avatarUrl: avatar };
    const medals = medalsFrom(parts["game-coordinator"] ?? "");
    if (medals.length) profile.medals = medals;
  } else if (parts["game-coordinator"]) {
    const medals = medalsFrom(parts["game-coordinator"]);
    if (medals.length) profile.medals = medals;
  }

  if (faceitHtml.trim()) {
    const games: Record<string, CsstCard> = {};
    for (const [label, html] of tabPanels(faceitHtml)) {
      const card = cardFrom(html);
      const level = html.match(/alt="Faceit level (\d+)"/i)?.[1];
      if (level) card.fields.Level = level;
      games[label] = card;
    }
    profile.faceit = { ...cardFrom(beforeTabs(faceitHtml)), games };
  }

  if (leetifyHtml.trim()) {
    profile.leetify = { ...cardFrom(leetifyHtml), ranks: leetifyRanks(parts.leetify ?? leetifyHtml) };
    if (!profile.leetify.ranks?.length) delete profile.leetify.ranks;
  }

  if (scopeHtml.trim()) {
    const aimAt = scopeHtml.search(/<p class="text-xs uppercase font-semibold">\s*Aim\s*<\/p>/i);
    const generalHtml = aimAt < 0 ? scopeHtml : scopeHtml.slice(0, aimAt);
    profile.scope = { ...cardFrom(generalHtml), weapons: scopeWeapons(scopeHtml) };
    if (!profile.scope.weapons || !Object.keys(profile.scope.weapons).length) delete profile.scope.weapons;
  }

  if (trackerHtml.trim()) {
    const card = cardFrom(trackerHtml);
    for (const [label, value] of Object.entries(cstrackerStats(trackerHtml))) {
      card.fields[label] ??= value;
    }
    const trust = trackerHtml.match(/cstracker-trust-value[^>]*>\s*([0-9.]+)/i)?.[1];
    profile.cstracker = {
      ...card,
      trust: trust ? `${trust}%` : card.fields.trust,
      factors: trustFactors(trackerHtml),
      matches: firstTable(trackerHtml),
    };
    if (!profile.cstracker.factors?.length) delete profile.cstracker.factors;
    if (!profile.cstracker.matches?.length) delete profile.cstracker.matches;
  }

  if (csstatsHtml.trim() && !/class="[^"]*hidden/.test(csstatsHtml.slice(0, 80))) {
    profile.csstats = { ...cardFrom(csstatsHtml), matches: firstTable(csstatsHtml) };
    if (!profile.csstats.matches?.length) delete profile.csstats.matches;
    if (!Object.keys(profile.csstats.fields).length && !profile.csstats.matches) delete profile.csstats;
  }

  if (inventoryHtml.trim()) {
    const items = inventoryItems(inventoryHtml);
    const value = cardFrom(inventoryHtml).fields["Inventory value"] ?? items.value;
    if (value || items.items.length) profile.inventory = { value, items: items.items };
  }

  const links = linksFromHtml(`${linksHtml}\n${steamHtml}\n${faceitHtml}\n${leetifyHtml}\n${trackerHtml}\n${csstatsHtml}\n${scopeHtml}`);
  if (Object.keys(links).length) profile.links = links;

  return profile;
}

/** Replace the FACEIT peak-ELO spinner for one game with the history fragment. */
export function applyFaceitHistory(html: string, game: string, historyHtml: string): string {
  const re = new RegExp(
    `<div\\b[^>]*hx-get="[^"]*faceit-history\\?game_id=${game.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?</div>`,
    "i",
  );
  if (re.test(html)) return html.replace(re, historyHtml);
  return `${html}\n${historyHtml}`;
}

/** Same-origin follow-up fragments referenced by the FACEIT card (peak ELO). */
export function faceitHistoryPaths(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/hx-get="([^"]*faceit-history[^"]*)"/gi)) {
    const path = match[1]!;
    if (path.startsWith("/") && !path.startsWith("//") && !out.includes(path)) out.push(path);
  }
  return out.slice(0, 4);
}

export function linksFromHtml(html: string): Partial<PlayerDossier["links"]> {
  const links: Partial<PlayerDossier["links"]> = {};
  for (const match of html.matchAll(/href=["'](https?:\/\/[^"'#]+)["']/gi)) {
    const href = match[1]!;
    if (/faceit\.com\/(?:[a-z]{2}\/)?players\//i.test(href)) links.faceit ??= href;
    else if (/leetify\.com/i.test(href)) links.leetify ??= href;
    else if (/steamcommunity\.com\/(id|profiles)\//i.test(href)) links.steam ??= href;
    else if (/csrep\.gg/i.test(href)) links.csrep ??= href;
    else if (/cstracker\.gg\/players\//i.test(href)) links.cstracker ??= href;
    else if (/csstats\.gg\/player\//i.test(href)) links.csstats ??= href;
    else if (/scope\.gg/i.test(href)) links.scope ??= href;
  }
  return links;
}

function cardFrom(html: string): CsstCard {
  const heading = headingLink(html);
  const fields: Record<string, string> = {};
  const notes: Record<string, string> = {};
  for (const chunk of html.split(/<p class="text-xs(?![^"]*font-semibold)[^"]*">/i).slice(1)) {
    const end = chunk.indexOf("</p>");
    if (end < 0) continue;
    const label = decode(chunk.slice(0, end)).replace(/\s+/g, " ").trim();
    if (!label) continue;
    const rest = chunk.slice(end + 4);
    const next = rest.search(/<p class="text-xs/i);
    const untilNext = next === -1 ? rest : rest.slice(0, next);
    const body = firstElement(untilNext) ?? untilNext;
    const value = fieldValue(label, body);
    if (!value) continue;
    fields[label] = value.value;
    if (value.note) notes[label] = value.note;
    else delete notes[label];
  }
  return {
    name: heading.name,
    url: heading.url,
    fields,
    notes: Object.keys(notes).length ? notes : undefined,
  };
}

function firstElement(html: string): string | undefined {
  const start = html.search(/<[a-z0-9]+\b/i);
  if (start < 0) return undefined;
  const open = html.slice(start).match(/^<([a-z0-9]+)\b[^>]*>/i);
  if (!open) return undefined;
  const tag = open[1]!;
  const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "gi");
  let depth = 0;
  let match: RegExpExecArray | null;
  re.lastIndex = start;
  while ((match = re.exec(html))) {
    if (match[0]!.startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(start, match.index + match[0].length);
  }
  return undefined;
}

function fieldValue(label: string, body: string): { value: string; note?: string } | undefined {
  if (/loading-spinner/i.test(body) && !/\d/.test(textOf(body))) return undefined;
  const longNote = [...body.matchAll(/data-tip="([^"]+)"/gi)]
    .map((m) => decode(m[1]!).replace(/\s+/g, " ").trim())
    .find((tip) => tip.length > 24 || tip.includes(":"));
  const datetime = body.match(/<time\b[^>]*datetime="([^"]+)"/i)?.[1];
  let value = textOf(expandTips(body));
  if (label === "Country") {
    const code = body.match(/flagsapi\.com\/([A-Z]{2})\//)?.[1];
    const language = textOf(body).replace(/^\/\s*/, "").trim();
    if (code && language && language !== code) value = `${code} / ${language}`;
    else if (code) value = code;
  } else if (!value) {
    value = body.match(/flagsapi\.com\/([A-Z]{2})\//)?.[1] ?? "";
  }
  if (datetime) value = datetime;
  value = value.replace(/\s+/g, " ").trim();
  if (!value) return undefined;
  const note = datetime && longNote && /^\d{1,2}:\d{2}/.test(longNote) ? undefined : longNote;
  return { value, note };
}

function expandTips(html: string): string {
  return html.replace(
    /<([a-z0-9]+)\b[^>]*\bdata-tip="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/gi,
    (full, _tag, tip, inner) => {
      if (/data-tip=/i.test(inner)) return full;
      const label = decode(tip).replace(/\s+/g, " ").trim();
      const value = textOf(inner);
      if (!label || !value) return inner;
      if (/^\d{1,2}:\d{2}/.test(label)) return value;
      if (label.length > 24 || label.includes(":")) return value;
      return `${label}: ${value}`;
    },
  );
}

function textOf(html: string): string {
  return decode(
    html
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<img\b[^>]*>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|tr|h\d)>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " "),
  ).trim();
}

function headingLink(html: string): { name?: string; url?: string } {
  const wrapped = html.match(
    /class="[^"]*text-xl[^"]*"[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/i,
  );
  if (wrapped?.[2]?.trim()) return { url: wrapped[1], name: decode(wrapped[2]).trim() };
  const anchor = html.match(
    /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*text-xl[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/i,
  );
  if (anchor?.[2]?.trim()) return { url: anchor[1], name: decode(anchor[2]).trim() };
  return {};
}

function beforeTabs(html: string): string {
  const at = html.search(/<input\b[^>]*aria-label="(?:csgo|cs2)"/i);
  return at === -1 ? html : html.slice(0, at);
}

function tabPanels(html: string): [string, string][] {
  const marks: { label: string; from: number }[] = [];
  for (const match of html.matchAll(/<input\b[^>]*aria-label="(csgo|cs2)"[^>]*>/gi)) {
    marks.push({ label: match[1]!.toLowerCase(), from: match.index! + match[0].length });
  }
  return marks.map((mark, i) => {
    const end = i + 1 < marks.length ? html.lastIndexOf("<input", marks[i + 1]!.from) : html.length;
    return [mark.label, html.slice(mark.from, end === -1 ? html.length : end)];
  });
}

function leetifyRanks(html: string): { mode: string; rank: string }[] {
  const block = html.match(/rank-leetify[\s\S]*$/i)?.[0] ?? "";
  if (!block) return [];
  const ranks: { mode: string; rank: string }[] = [];
  const premier = block.match(/cs2rating[^"]*"[^>]*>\s*([^<]+)/i)?.[1];
  if (premier) ranks.push({ mode: "Premier", rank: textOf(premier) });
  const wingman = block.match(/wingman(\d+)\.svg/i)?.[1];
  if (wingman) ranks.push({ mode: "Wingman", rank: wingman });
  for (const match of block.matchAll(/alt="(de_[^"]+)"[\s\S]{0,180}?skillgroup(\d+)\.svg/gi)) {
    ranks.push({ mode: match[1]!, rank: match[2]! });
  }
  return ranks;
}

function scopeWeapons(html: string): Record<string, Record<string, string>> | undefined {
  const aimAt = html.search(/<p class="text-xs uppercase font-semibold">\s*Aim\s*<\/p>/i);
  if (aimAt < 0) return undefined;
  const aim = html.slice(aimAt);
  const parts = aim.split(/<img\b[^>]*alt="([^"]+)"[^>]*>/i);
  const weapons: Record<string, Record<string, string>> = {};
  for (let i = 1; i < parts.length; i += 2) {
    const name = decode(parts[i] ?? "").trim();
    const body = parts[i + 1] ?? "";
    if (!name || /logo|scope/i.test(name)) continue;
    const card = cardFrom(body.split(/<img\b/i)[0] ?? body);
    if (Object.keys(card.fields).length) weapons[name] = card.fields;
  }
  return Object.keys(weapons).length ? weapons : undefined;
}

function cstrackerStats(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(/<p class="cstracker-label">([\s\S]*?)<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const label = textOf(match[1]!);
    const value = textOf(match[2]!);
    if (label && value) fields[label] = value;
  }
  return fields;
}

function trustFactors(html: string): { label: string; delta: string }[] | undefined {
  const list = html.match(/<ul>([\s\S]*?)<\/ul>/i)?.[1];
  if (!list) return undefined;
  const factors: { label: string; delta: string }[] = [];
  for (const item of list.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const spans = [...item[1]!.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => textOf(m[1]!));
    if (spans.length >= 2 && spans[0] && spans[1]) factors.push({ label: spans[0], delta: spans[1] });
  }
  return factors.length ? factors : undefined;
}

function firstTable(html: string): CsstMatch[] | undefined {
  const table = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) return undefined;
  const headers = [...(table.match(/<thead>[\s\S]*?<\/thead>/i)?.[0] ?? "").matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => textOf(m[1]!))
    .filter(Boolean);
  if (!headers.length) return undefined;
  const body = table.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] ?? "";
  const rows: CsstMatch[] = [];
  for (const row of body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    const record: CsstMatch = {};
    cells.forEach((cell, i) => {
      const header = headers[i] ?? `col${i}`;
      const href = cell[1]!.match(/href="(https?:\/\/[^"]+)"/i)?.[1];
      const value = textOf(cell[1]!);
      if (header.toLowerCase() === "link" && href) record[header] = href;
      else if (value) record[header] = value;
      else if (href) record[header] = href;
    });
    if (Object.keys(record).length) rows.push(record);
    if (rows.length >= 40) break;
  }
  return rows.length ? rows : undefined;
}

function medalsFrom(html: string): string[] {
  const seen = new Set<string>();
  const medals: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0]!;
    const title = tag.match(/\btitle="([^"]+)"/i)?.[1];
    const name = title ? decode(title).trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    medals.push(name);
  }
  return medals;
}

function inventoryItems(html: string): { value?: string; items: { name: string; price?: string; wear?: string; url?: string }[] } {
  const items: { name: string; price?: string; wear?: string; url?: string }[] = [];
  const headingValue = html.match(/CS2 Inventory<\/span>\s*([^<]+)/i)?.[1];
  for (const match of html.matchAll(/\btitle="([^"]+)"/gi)) {
    const name = decode(match[1]!).trim();
    if (!name) continue;
    const around = html.slice(Math.max(0, match.index! - 700), match.index! + 500);
    const price = around.match(/font-semibold">\s*([^<]+?)\s*</)?.[1];
    const wear = textOf(around.match(/<p class="[^"]*text-neutral-500[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const url = around.match(/href="(https?:\/\/steamcommunity\.com\/market\/[^"]+)"/i)?.[1];
    items.push({
      name,
      price: price ? decode(price).trim() : undefined,
      wear: wear || undefined,
      url,
    });
    if (items.length >= 40) break;
  }
  return { value: headingValue ? textOf(headingValue) : undefined, items };
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}
