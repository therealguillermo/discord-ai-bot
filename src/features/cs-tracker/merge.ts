import {
  emptyDossier,
  type PlayerDossier,
  type ProviderPartial,
} from "./dossier.js";

/** Merge provider partials. First non-null field wins; provenance records who supplied it. */
export function mergePartials(steamId64: string, partials: ProviderPartial[]): PlayerDossier {
  const d = emptyDossier(steamId64);
  const errors: string[] = [];
  const raw: Record<string, unknown> = {};

  // Prefer CSRep → Steam → Faceit → CSST → CSTracker for overlapping identity/rank fields
  const order: ProviderPartial["provider"][] = ["csrep", "steam", "faceit", "csst", "cstracker"];
  const byProvider = new Map(partials.map((p) => [p.provider, p]));

  for (const name of order) {
    const p = byProvider.get(name);
    if (!p) continue;
    d.sources[name] = p.status;
    if (p.error) errors.push(p.error);
    if (p.timestamp) d.freshness.providerTimestamps[name] = p.timestamp;
    if (p.status !== "ok") continue;
    if (p.raw !== undefined) raw[name] = trimRaw(p.raw);

    assignObj(d.identity, p.identity, d.provenance, name, "identity");
    assignObj(d.cs2, p.cs2, d.provenance, name, "cs2");
    assignObj(d.faceit, p.faceit, d.provenance, name, "faceit");
    assignObj(d.leetify, p.leetify, d.provenance, name, "leetify");
    assignObj(d.trust, p.trust, d.provenance, name, "trust");
    assignObj(d.bans, p.bans, d.provenance, name, "bans");
    if (p.tracker) {
      for (const [k, v] of Object.entries(p.tracker)) {
        if (d.tracker[k] === undefined && v !== undefined && v !== null && v !== "") {
          d.tracker[k] = v;
          d.provenance[`tracker.${k}`] = name;
        }
      }
    }
    if (p.links) {
      for (const [k, v] of Object.entries(p.links)) {
        const key = k as keyof PlayerDossier["links"];
        if (v && !d.links[key]) {
          d.links[key] = v;
          d.provenance[`links.${key}`] = name;
        }
      }
    }
  }

  d.freshness.fetchedAt = new Date().toISOString();
  if (errors.length) d.errors = errors;
  if (Object.keys(raw).length) d.raw = raw;
  return d;
}

function assignObj(
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
  provenance: Record<string, string>,
  provider: string,
  prefix: string,
): void {
  if (!source) return;
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined || v === null || v === "") continue;
    if (target[k] === undefined || target[k] === null || target[k] === "") {
      target[k] = v;
      provenance[`${prefix}.${k}`] = provider;
    } else if (
      typeof target[k] === "object" &&
      target[k] !== null &&
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v)
    ) {
      const cur = target[k] as Record<string, unknown>;
      for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
        if (cur[nk] === undefined && nv !== undefined) {
          cur[nk] = nv;
          provenance[`${prefix}.${k}.${nk}`] = provider;
        }
      }
    }
  }
}

function trimRaw(raw: unknown): unknown {
  const s = JSON.stringify(raw);
  if (s.length <= 8000) return raw;
  return { _truncated: true, preview: s.slice(0, 8000) };
}
