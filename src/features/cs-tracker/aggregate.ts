import { config } from "../../config.js";
import { TtlCache } from "./cache.js";
import type { PlayerDossier } from "./dossier.js";
import { mergePartials } from "./merge.js";
import { createCsrepClient, type CsrepClient } from "./providers/csrep.js";
import { fetchCsst } from "./providers/csst.js";
import { fetchCstracker } from "./providers/cstracker.js";
import { fetchFaceit } from "./providers/faceit.js";
import { fetchSteam } from "./providers/steam.js";

export type Aggregator = {
  csrep: CsrepClient | null;
  fetchDossier: (steamId64: string, opts?: { bypassCache?: boolean }) => Promise<PlayerDossier>;
};

export function createAggregator(): Aggregator {
  const csrep = createCsrepClient(config.csrepApiKey);
  const cache = new TtlCache<PlayerDossier>(config.csCacheTtlSeconds * 1000);

  async function fetchDossier(
    steamId64: string,
    opts: { bypassCache?: boolean } = {},
  ): Promise<PlayerDossier> {
    if (!opts.bypassCache) {
      const hit = cache.get(steamId64);
      if (hit) return hit;
    }

    const partials = await Promise.all([
      csrep
        ? csrep.getPlayer(steamId64)
        : Promise.resolve({ provider: "csrep" as const, status: "skipped" as const }),
      fetchCsst(steamId64, { enabled: config.csstEnabled, apiKey: config.csstApiKey }),
      fetchCstracker(steamId64, { enabled: config.cstrackerEnabled }),
      fetchFaceit(steamId64, config.faceitApiKey),
      fetchSteam(steamId64, config.steamWebApiKey),
    ]);

    const dossier = mergePartials(steamId64, partials);
    cache.set(steamId64, dossier);
    return dossier;
  }

  return { csrep, fetchDossier };
}

export { mergePartials };
