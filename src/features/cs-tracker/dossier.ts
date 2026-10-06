export type SourceStatus = "ok" | "error" | "skipped";

export interface PlayerDossier {
  steamId64: string;
  identity: {
    personaName?: string;
    avatarUrl?: string;
    profileUrl?: string;
    country?: string;
  };
  cs2: {
    hours?: number;
    premierRating?: number;
    wins?: number;
    gc?: Record<string, unknown>;
  };
  faceit: {
    level?: number;
    elo?: number;
    nickname?: string;
    url?: string;
    stats?: Record<string, unknown>;
  };
  leetify: {
    rating?: number;
    ranks?: Record<string, unknown>;
    url?: string;
  };
  trust: {
    score?: number;
    flags?: string[];
    notes?: string;
  };
  bans: {
    vac?: boolean;
    gameBan?: boolean;
    community?: boolean;
    numberOfBans?: number;
    daysSinceLastBan?: number;
  };
  tracker: Record<string, unknown>;
  links: {
    csrep?: string;
    csst?: string;
    cstracker?: string;
    faceit?: string;
    steam?: string;
    leetify?: string;
    csstats?: string;
    scope?: string;
  };
  freshness: {
    fetchedAt: string;
    providerTimestamps: Record<string, string>;
  };
  sources: {
    csrep: SourceStatus;
    csst: SourceStatus;
    cstracker: SourceStatus;
    faceit: SourceStatus;
    steam: SourceStatus;
  };
  /** field path → provider that supplied it */
  provenance: Record<string, string>;
  errors?: string[];
  /** Raw provider payloads for debugging / rich agent formatting (trimmed). */
  raw?: Record<string, unknown>;
}

export type ProviderPartial = {
  provider: keyof PlayerDossier["sources"];
  status: SourceStatus;
  error?: string;
  timestamp?: string;
  identity?: PlayerDossier["identity"];
  cs2?: PlayerDossier["cs2"];
  faceit?: PlayerDossier["faceit"];
  leetify?: PlayerDossier["leetify"];
  trust?: PlayerDossier["trust"];
  bans?: PlayerDossier["bans"];
  tracker?: Record<string, unknown>;
  links?: Partial<PlayerDossier["links"]>;
  raw?: unknown;
};

export function emptyDossier(steamId64: string): PlayerDossier {
  return {
    steamId64,
    identity: {},
    cs2: {},
    faceit: {},
    leetify: {},
    trust: {},
    bans: {},
    tracker: {},
    links: {
      csrep: `https://csrep.gg/player/${steamId64}`,
      csst: `https://csst.at/profile/${steamId64}`,
      cstracker: `https://cstracker.gg/players/${steamId64}`,
      steam: `https://steamcommunity.com/profiles/${steamId64}`,
    },
    freshness: { fetchedAt: new Date().toISOString(), providerTimestamps: {} },
    sources: {
      csrep: "skipped",
      csst: "skipped",
      cstracker: "skipped",
      faceit: "skipped",
      steam: "skipped",
    },
    provenance: {},
    errors: [],
  };
}
