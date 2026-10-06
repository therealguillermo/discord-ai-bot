import { config } from "../../config.js";
import { TtlCache } from "./cache.js";
import type { PlayerDossier, ProviderPartial } from "./dossier.js";
import { mergePartials } from "./merge.js";
import { fetchCsst } from "./providers/csst.js";
import { fetchCstracker } from "./providers/cstracker.js";
import { fetchFaceit } from "./providers/faceit.js";
import { createLeetifyClient, fetchLeetifyProfile, type LeetifyClient } from "./providers/leetify.js";
import { fetchSteam } from "./providers/steam.js";

export type Aggregator = {
  leetify: LeetifyClient | null;
  fetchDossier: (steamId64: string, opts?: { bypassCache?: boolean }) => Promise<PlayerDossier>;
  fetchDossiers: (steamIds: string[], opts?: { bypassCache?: boolean }) => Promise<PlayerDossier[]>;
};

export function createAggregator(): Aggregator {
  const leetify = config.leetifyEnabled ? createLeetifyClient(config.leetifyApiKey) : null;
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

    const built = await Promise.all(
      missing.map(async (id) => {
        const partials = await Promise.all([
          Promise.resolve({ provider: "csrep", status: "skipped" } satisfies ProviderPartial),
          fetchCsst(id, { enabled: config.csstEnabled, apiKey: config.csstApiKey }),
          fetchCstracker(id, { enabled: config.cstrackerEnabled }),
          fetchFaceit(id, config.faceitApiKey),
          fetchLeetifyProfile(id, leetify),
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

  return { leetify, fetchDossier, fetchDossiers };
}

export { mergePartials };
