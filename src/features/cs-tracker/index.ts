import path from "node:path";
import { config } from "../../config.js";
import type { ToolDefinition } from "../../tools/types.js";
import type { Feature } from "../types.js";
import { UserError } from "../types.js";
import { createAggregator } from "./aggregate.js";
import { LinkStore } from "./links.js";
import { fetchCstrackerLeaderboard } from "./providers/cstracker.js";
import { fetchSteamProfile } from "./providers/steam-profile.js";
import { resolveSteamId64 } from "./steam-id.js";

const links = new LinkStore({ filePath: path.join(config.dataDir, "cs-links.json") });
const aggregator = createAggregator();

async function resolveToSteamId64(raw: string): Promise<string> {
  return resolveSteamId64(raw, { steamWebApiKey: config.steamWebApiKey });
}

function targetSteamIds(input: {
  steam?: unknown;
  user_id?: unknown;
  all?: unknown;
  requesterId: string;
}): string[] {
  const steam = input.steam != null ? String(input.steam).trim() : "";
  const userId = input.user_id != null ? String(input.user_id).trim() : "";
  const all = Boolean(input.all);

  if (steam) return []; // resolved async by caller

  const discordId = userId || input.requesterId;
  if (userId && !/^\d{15,25}$/.test(userId)) {
    throw new UserError("user_id must be a Discord user ID.");
  }

  const accounts = links.list(discordId);
  if (accounts.length === 0) {
    throw new UserError(
      discordId === input.requesterId
        ? "No Steam account linked. Only the bot owner can save one."
        : `Discord user ${discordId} has no linked Steam accounts.`,
    );
  }
  if (all) return accounts.map((a) => a.steamId64);
  const primary = links.primary(discordId);
  return [primary!.steamId64];
}

const linkTool: ToolDefinition = {
  name: "cs_link_steam",
  description:
    "Save a Steam account on a Discord user (1 Discord → many Steam). Only the bot owner may call this. " +
    "Pass user_id to save it for someone else; omit user_id to link the owner. " +
    "Accepts SteamID64, steamcommunity URL, or vanity (needs STEAM_WEB_API_KEY). " +
    "The first account for that user becomes primary unless primary is set.",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string", description: "SteamID64, profile URL, or vanity." },
      label: { type: "string", description: "Optional label, e.g. main / smurf." },
      primary: { type: "boolean", description: "Make this the primary account. Omit unless asked." },
      user_id: { type: "string", description: "Discord user ID to save the Steam account on. Owner only." },
    },
    required: ["steam"],
  },
  handler: async (input, ctx) => {
    if (ctx.requesterId !== config.ownerId) {
      throw new UserError("Only the bot owner can link Steam accounts.");
    }
    let targetId = ctx.requesterId;
    if (input.user_id != null && String(input.user_id).trim()) {
      targetId = String(input.user_id).trim();
      if (!/^\d{15,25}$/.test(targetId)) throw new UserError("user_id must be a Discord user ID.");
    }
    const steamId64 = await resolveToSteamId64(String(input.steam ?? ""));
    const link = links.link(targetId, steamId64, {
      label: input.label != null ? String(input.label) : undefined,
      primary: input.primary === undefined ? undefined : Boolean(input.primary),
    });
    return { linked: link, discord_user_id: targetId, accounts: links.list(targetId) };
  },
};

const unlinkTool: ToolDefinition = {
  name: "cs_unlink_steam",
  description: "Unlink a Steam account from the requester (by SteamID64 or label).",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string", description: "SteamID64 or label to unlink." },
      user_id: { type: "string", description: "Discord user ID (owner only for others)." },
    },
    required: ["steam"],
  },
  handler: async (input, ctx) => {
    let targetId = ctx.requesterId;
    if (input.user_id != null && String(input.user_id).trim()) {
      targetId = String(input.user_id).trim();
      if (targetId !== ctx.requesterId && ctx.requesterId !== config.ownerId) {
        throw new UserError("Only the bot owner can unlink Steam accounts for other users.");
      }
    }
    const removed = links.unlink(targetId, String(input.steam ?? ""));
    return { unlinked: removed, accounts: links.list(targetId) };
  },
};

const listLinksTool: ToolDefinition = {
  name: "cs_list_links",
  description: "List Steam accounts linked to a Discord user (default: requester).",
  input_schema: {
    type: "object",
    properties: {
      user_id: { type: "string", description: "Discord user ID." },
    },
  },
  handler: async (input, ctx) => {
    const userId = input.user_id != null && String(input.user_id).trim()
      ? String(input.user_id).trim()
      : ctx.requesterId;
    if (!/^\d{15,25}$/.test(userId)) throw new UserError("user_id must be a Discord user ID.");
    return { discord_user_id: userId, accounts: links.list(userId) };
  },
};

const setPrimaryTool: ToolDefinition = {
  name: "cs_set_primary",
  description: "Mark one of the requester's linked Steam accounts as primary.",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string", description: "SteamID64 or label." },
    },
    required: ["steam"],
  },
  handler: async (input, ctx) => {
    const primary = links.setPrimary(ctx.requesterId, String(input.steam ?? ""));
    return { primary, accounts: links.list(ctx.requesterId) };
  },
};

const playerTool: ToolDefinition = {
  name: "cs_player",
  description:
    "Fetch a merged CS player dossier from CSST + CSTracker + Leetify (+ optional Faceit/Steam APIs). CSRep is obsolete and is not called. " +
    "Pass steam (ID/URL) and/or Discord user_id (uses their primary link). " +
    "Omit both to use the requester's primary link. Set all=true to fetch every linked account. " +
    "Returns organized sections. When sources.leetify is ok, dossier.raw.leetify is the official profile — present those numbers unchanged and say Data Provided by Leetify. When CSST responded, dossier.raw.csst.profile holds the labeled cards (steam, faceit, leetify, scope, cstracker, csstats, inventory). Format the Discord reply from this data; never invent stats.",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string", description: "SteamID64, URL, or vanity." },
      user_id: { type: "string", description: "Discord user ID with linked Steam account(s)." },
      all: { type: "boolean", description: "If true with user_id/requester, fetch all linked accounts." },
      refresh: { type: "boolean", description: "Bypass the dossier cache." },
    },
  },
  handler: async (input, ctx) => {
    const bypass = Boolean(input.refresh);
    const steamRaw = input.steam != null ? String(input.steam).trim() : "";

    let ids: string[];
    if (steamRaw) {
      ids = [await resolveToSteamId64(steamRaw)];
    } else {
      ids = targetSteamIds({
        steam: input.steam,
        user_id: input.user_id,
        all: input.all,
        requesterId: ctx.requesterId,
      });
    }

    const dossiers = await aggregator.fetchDossiers(ids, { bypassCache: bypass });
    return dossiers.length === 1 ? { dossier: dossiers[0] } : { dossiers };
  },
};

const compareTool: ToolDefinition = {
  name: "cs_compare",
  description:
    "Compare 2–5 CS players. Each target is { steam?: string, user_id?: string }. " +
    "Returns side-by-side key fields plus full dossiers.",
  input_schema: {
    type: "object",
    properties: {
      targets: {
        type: "array",
        description: "2–5 targets.",
        items: {
          type: "object",
          properties: {
            steam: { type: "string" },
            user_id: { type: "string" },
          },
        },
      },
    },
    required: ["targets"],
  },
  handler: async (input, ctx) => {
    const targets = Array.isArray(input.targets) ? input.targets : [];
    if (targets.length < 2 || targets.length > 5) {
      throw new UserError("cs_compare needs between 2 and 5 targets.");
    }

    const resolved: { label: string; steamId64: string }[] = [];
    for (const t of targets) {
      const row = t as { steam?: string; user_id?: string };
      if (row.steam) {
        const id = await resolveToSteamId64(String(row.steam));
        resolved.push({ label: String(row.steam), steamId64: id });
      } else if (row.user_id) {
        const uid = String(row.user_id);
        const primary = links.primary(uid);
        if (!primary) throw new UserError(`Discord user ${uid} has no linked Steam account.`);
        resolved.push({ label: `<@${uid}>`, steamId64: primary.steamId64 });
      } else {
        const primary = links.primary(ctx.requesterId);
        if (!primary) throw new UserError("Requester has no linked Steam account.");
        resolved.push({ label: "requester", steamId64: primary.steamId64 });
      }
    }

    const fetched = await aggregator.fetchDossiers(resolved.map((r) => r.steamId64));
    const dossiers = resolved.map((r, i) => ({
      label: r.label,
      steamId64: r.steamId64,
      dossier: fetched[i]!,
    }));

    const comparison = dossiers.map((d) => ({
      label: d.label,
      steamId64: d.steamId64,
      personaName: d.dossier.identity.personaName,
      premier: d.dossier.cs2.premierRating,
      hours: d.dossier.cs2.hours,
      faceitLevel: d.dossier.faceit.level,
      faceitElo: d.dossier.faceit.elo,
      leetify: d.dossier.leetify.rating,
      trust: d.dossier.trust.score,
      vac: d.dossier.bans.vac,
    }));

    return { comparison, dossiers };
  },
};

const leetifyTool: ToolDefinition = {
  name: "cs_leetify",
  description:
    "Read the official Leetify API. resource=profile or matches takes steam (SteamID64/URL/vanity) or leetify_id. " +
    "resource=match takes game_id (the id on a recent match). resource=match_by_source takes data_source " +
    "(matchmaking, faceit, renown, …) and data_source_id. " +
    "Profile is also merged into cs_player. Present every metric exactly as returned (Aim is 0–100, winrate is a fraction). " +
    "Link https://leetify.com/app/profile/{steam64} as View on Leetify and say Data Provided by Leetify.",
  input_schema: {
    type: "object",
    properties: {
      resource: {
        type: "string",
        enum: ["profile", "matches", "match", "match_by_source"],
        description: "Which Leetify read to call. Default: profile.",
      },
      steam: { type: "string", description: "SteamID64, profile URL, or vanity. For profile and matches." },
      user_id: { type: "string", description: "Discord user whose primary Steam link is used when steam is omitted." },
      leetify_id: { type: "string", description: "Leetify user id. Alternative to steam for profile and matches." },
      game_id: { type: "string", description: "Leetify game id for resource=match." },
      data_source: { type: "string", description: "Match data source, such as matchmaking or faceit." },
      data_source_id: { type: "string", description: "That source's own match id." },
    },
  },
  handler: async (input, ctx) => {
    if (!aggregator.leetify) throw new UserError("Leetify lookups are disabled (LEETIFY_ENABLED=false).");
    const resource = String(input.resource ?? "profile").trim().toLowerCase();
    const client = aggregator.leetify;

    if (resource === "match") {
      const gameId = String(input.game_id ?? "").trim();
      if (!gameId) throw new UserError("game_id is required for resource=match.");
      const match = await leetifyCall(() => client.getMatch(gameId));
      return { resource, game_id: gameId, attribution: "Data Provided by Leetify", match };
    }

    if (resource === "match_by_source") {
      const dataSource = String(input.data_source ?? "").trim();
      const dataSourceId = String(input.data_source_id ?? "").trim();
      if (!dataSource || !dataSourceId) {
        throw new UserError("data_source and data_source_id are required for resource=match_by_source.");
      }
      const match = await leetifyCall(() => client.getMatchBySource(dataSource, dataSourceId));
      return {
        resource,
        data_source: dataSource,
        data_source_id: dataSourceId,
        attribution: "Data Provided by Leetify",
        match,
      };
    }

    if (resource !== "profile" && resource !== "matches") {
      throw new UserError("resource must be profile, matches, match, or match_by_source.");
    }

    const leetifyId = String(input.leetify_id ?? "").trim();
    const steamRaw = String(input.steam ?? "").trim();
    if (leetifyId && steamRaw) throw new UserError("Pass steam or leetify_id, not both.");

    const query = leetifyId
      ? { leetifyId }
      : { steam64Id: steamRaw ? await resolveToSteamId64(steamRaw) : requesterSteam(input.user_id, ctx.requesterId) };

    if (resource === "matches") {
      const matches = await leetifyCall(() => client.getMatches(query));
      return { resource, attribution: "Data Provided by Leetify", matches };
    }
    const profile = await leetifyCall(() => client.getProfile(query));
    const steam64 = typeof profile.steam64_id === "string" ? profile.steam64_id : query.steam64Id;
    return {
      resource,
      url: steam64 ? `https://leetify.com/app/profile/${steam64}` : undefined,
      attribution: "Data Provided by Leetify",
      profile,
    };
  },
};

async function leetifyCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(err instanceof Error ? err.message : String(err));
  }
}

function requesterSteam(userId: unknown, requesterId: string): string {
  const ids = targetSteamIds({ user_id: userId, requesterId });
  return ids[0]!;
}

const refreshTool: ToolDefinition = {
  name: "cs_refresh",
  description: "Bypass the dossier cache and return a fresh merged dossier. CSRep is not contacted.",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string" },
      user_id: { type: "string" },
    },
  },
  handler: async (input, ctx) => {
    const steamRaw = input.steam != null ? String(input.steam).trim() : "";
    let steamId64: string;
    if (steamRaw) {
      steamId64 = await resolveToSteamId64(steamRaw);
    } else {
      const ids = targetSteamIds({
        user_id: input.user_id,
        requesterId: ctx.requesterId,
      });
      steamId64 = ids[0]!;
    }
    const dossier = await aggregator.fetchDossier(steamId64, { bypassCache: true });
    return { refreshed: true, dossier };
  },
};

const steamProfileTool: ToolDefinition = {
  name: "steam_profile",
  description:
    "Read a Steam user's public profile: identity, bio, location, member since, online status, current game, bans, Steam level, badges, friends, groups, and the game library (recently played plus most played). " +
    "Official Steam Web API plus the public community profile. Not the CS dossier. " +
    "Pass steam (SteamID64, profile URL, or vanity) and/or Discord user_id (their primary linked account). Omit both to use the requester's primary link. " +
    "Needs STEAM_WEB_API_KEY. Each section says whether it is public or private. " +
    "Format the Discord reply only from this result. Never invent names, games, hours, bans, or counts. If a section is private, say that part is hidden.",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string", description: "SteamID64, profile URL, or vanity." },
      user_id: { type: "string", description: "Discord user ID with a linked Steam account." },
      limit: { type: "integer", description: "How many games to return in each games list. 1-25, default 10." },
    },
  },
  handler: async (input, ctx) => {
    if (!config.steamWebApiKey) {
      throw new UserError("Steam profile lookup needs STEAM_WEB_API_KEY in the bot env.");
    }
    const steamRaw = input.steam != null ? String(input.steam).trim() : "";
    const steamId64 = steamRaw
      ? await resolveToSteamId64(steamRaw)
      : requesterSteam(input.user_id, ctx.requesterId);
    const limit = Math.min(25, Math.max(1, Number(input.limit ?? 10) || 10));
    try {
      return await fetchSteamProfile(steamId64, config.steamWebApiKey, limit);
    } catch (err) {
      if (err instanceof UserError) throw err;
      throw new UserError(err instanceof Error ? err.message : String(err));
    }
  },
};

const leaderboardTool: ToolDefinition = {
  name: "cs_leaderboard",
  description:
    "Fetch CSTracker.gg leaderboard rows (best-effort HTML parse). " +
    "Format as a short ranked list; note if parsing was partial.",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "1-50, default 15." },
    },
  },
  handler: async (input) => {
    const limit = Math.min(50, Math.max(1, Number(input.limit ?? 15) || 15));
    const result = await fetchCstrackerLeaderboard({
      enabled: config.cstrackerEnabled,
      limit,
    });
    if (!result.ok) throw new UserError(result.error ?? "CSTracker leaderboard unavailable.");
    return result;
  },
};

export const csTrackerFeature: Feature = {
  name: "CS Tracker",
  tools: [
    linkTool,
    unlinkTool,
    listLinksTool,
    setPrimaryTool,
    playerTool,
    steamProfileTool,
    leetifyTool,
    compareTool,
    refreshTool,
    leaderboardTool,
  ],
  start: async () => {
    await links.load();
    const providers = [
      config.csstEnabled ? "csst" : null,
      config.cstrackerEnabled ? "cstracker" : null,
      config.leetifyEnabled ? (config.leetifyApiKey ? "leetify" : "leetify(no key)") : null,
      config.faceitApiKey ? "faceit" : null,
      config.steamWebApiKey ? "steam" : null,
    ].filter(Boolean);
    console.log(`[cs-tracker] ready; providers: ${providers.join(", ") || "(none configured)"}`);
  },
  stop: async () => {
    await links.flush();
  },
};
