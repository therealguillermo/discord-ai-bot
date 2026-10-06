import { config } from "../../config.js";
import { TtlCache } from "./cache.js";
import type { PlayerDossier, ProviderPartial } from "./dossier.js";
import { mergePartials } from "./merge.js";
import { createCsrepClient, type CsrepClient } from "./providers/csrep.js";
import { fetchCsst } from "./providers/csst.js";
import { fetchCstracker } from "./providers/cstracker.js";
import { fetchFaceit } from "./providers/faceit.js";
import { fetchSteam } from "./providers/steam.js";

export type Aggregator = {
  csrep: CsrepClient | null;
  fetchDossier: (steamId64: string, opts?: { bypassCache?: boolean }) => Promise<PlayerDossier>;
  /** Same as fetchDossier, but CSRep is loaded with one batch request when several IDs are missing. */
  fetchDossiers: (steamIds: string[], opts?: { bypassCache?: boolean }) => Promise<PlayerDossier[]>;
};

export function createAggregator(): Aggregator {
  const csrep = createCsrepClient(config.csrepApiKey);
  const cache = new TtlCache<PlayerDossier>(config.csCacheTtlSeconds * 1000);

  async function fetchDossier(
    steamId64: string,
    opts: { bypassCache?: boolean } = {},
  ): Promise<PlayerDossier> {
    const [dossier] = await fetchDossiers([steamId64], opts);
    return dossier!;
  }

  async function fetchDossiers(
    steamIds: string[],
    opts: { bypassCache?: boolean } = {},
  ): Promise<PlayerDossier[]> {
    const cached = new Map<string, PlayerDossier>();
    const missing: string[] = [];
    for (const id of steamIds) {
      if (cached.has(id) || missing.includes(id)) continue;
      if (!opts.bypassCache) {
        const hit = cache.get(id);
        if (hit) {
          cached.set(id, hit);
          continue;
        }
      }
      missing.push(id);
    }

    const csrepById = new Map<string, ProviderPartial>();
    if (csrep && missing.length === 1) {
      csrepById.set(missing[0]!, await csrep.getPlayer(missing[0]!));
    } else if (csrep && missing.length > 1) {
      const partials = await csrep.getPlayers(missing);
      const keyed = partials.map((partial) => steamIdOf(partial));
      const inOrder = keyed.length === missing.length && keyed.every((id, i) => !id || id === missing[i]);
      if (inOrder) {
        partials.forEach((partial, i) => csrepById.set(missing[i]!, partial));
      } else {
        keyed.forEach((id, i) => {
          if (id) csrepById.set(id, partials[i]!);
        });
      }
    }

    const built = await Promise.all(
      missing.map(async (id) => {
        const csrepPartial: ProviderPartial = csrepById.get(id)
          ?? (csrep
            ? { provider: "csrep", status: "error", error: "CSRep did not return this player.", raw: { steamId64: id } }
            : { provider: "csrep", status: "skipped" });
        const partials = await Promise.all([
          Promise.resolve(csrepPartial),
          fetchCsst(id, { enabled: config.csstEnabled, apiKey: config.csstApiKey }),
          fetchCstracker(id, { enabled: config.cstrackerEnabled }),
          fetchFaceit(id, config.faceitApiKey),
          fetchSteam(id, config.steamWebApiKey),
        ]);
        const dossier = mergePartials(id, partials);
        cache.set(id, dossier);
        return dossier;
      }),
    );
    const byId = new Map(built.map((dossier) => [dossier.steamId64, dossier]));
    return steamIds.map((id) => cached.get(id) ?? byId.get(id)!);
  }

  return { csrep, fetchDossier, fetchDossiers };
}

function steamIdOf(partial: ProviderPartial): string | undefined {
  if (!partial.raw || typeof partial.raw !== "object") return undefined;
  const raw = partial.raw as Record<string, unknown>;
  const id = String(raw.id ?? raw.steamId ?? raw.steamId64 ?? "");
  return /^7656119\d{10}$/.test(id) ? id : undefined;
}

export { mergePartials };
