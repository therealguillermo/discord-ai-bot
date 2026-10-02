import path from "node:path";
import { config } from "../../config.js";
import type { ToolDefinition } from "../../tools/types.js";
import type { Feature } from "../types.js";
import { UserError } from "../types.js";
import { createAggregator } from "./aggregate.js";
import { LinkStore } from "./links.js";
import { fetchCstrackerLeaderboard } from "./providers/cstracker.js";
import { resolveSteamId64 } from "./steam-id.js";

const links = new LinkStore({ filePath: path.join(config.dataDir, "cs-links.json") });
const aggregator = createAggregator();

async function resolveToSteamId64(raw: string): Promise<string> {
  return resolveSteamId64(raw, {
    steamWebApiKey: config.steamWebApiKey,
    searchCsrep: aggregator.csrep
      ? async (query) => {
          const hits = await aggregator.csrep!.search(query);
          return hits[0]?.steamId64 ?? null;
        }
      : undefined,
  });
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
        ? "No Steam account linked. Ask them to link one with cs_link_steam (SteamID64 or profile URL)."
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
    "Link a Steam account to a Discord user (1 Discord → many Steam). " +
    "Defaults to the requester. Pass user_id only when the owner is linking for someone else. " +
    "Accepts SteamID64, steamcommunity URL, or vanity (needs STEAM_WEB_API_KEY).",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string", description: "SteamID64, profile URL, or vanity." },
      label: { type: "string", description: "Optional label, e.g. main / smurf." },
      primary: { type: "boolean", description: "Make this the primary account." },
      user_id: { type: "string", description: "Discord user ID (owner only for others)." },
    },
    required: ["steam"],
  },
  handler: async (input, ctx) => {
    let targetId = ctx.requesterId;
    if (input.user_id != null && String(input.user_id).trim()) {
      targetId = String(input.user_id).trim();
      if (!/^\d{15,25}$/.test(targetId)) throw new UserError("user_id must be a Discord user ID.");
      if (targetId !== ctx.requesterId && ctx.requesterId !== config.ownerId) {
        throw new UserError("Only the bot owner can link Steam accounts for other users.");
      }
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
    "Fetch a merged CS player dossier from CSRep + CSST + CSTracker (+ optional Faceit/Steam APIs). " +
    "Pass steam (ID/URL) and/or Discord user_id (uses their primary link). " +
    "Omit both to use the requester's primary link. Set all=true to fetch every linked account. " +
    "Returns organized sections — format the Discord reply from this data; never invent stats.",
  input_schema: {
    type: "object",
    properties: {
      steam: { type: "string", description: "SteamID64, URL, or vanity." },
      user_id: { type: "string", description: "Discord user ID with linked Steam account(s)." },
      all: { type: "boolean", description: "If true with user_id/requester, fetch all linked accounts." },
      refresh: { type: "boolean", description: "Bypass cache (and request CSRep refresh if keyed)." },
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

    if (bypass && aggregator.csrep) {
      await Promise.allSettled(ids.map((id) => aggregator.csrep!.refresh(id)));
    }

    const dossiers = await Promise.all(
      ids.map((id) => aggregator.fetchDossier(id, { bypassCache: bypass })),
    );
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

    const dossiers = await Promise.all(
      resolved.map(async (r) => ({
        label: r.label,
        steamId64: r.steamId64,
        dossier: await aggregator.fetchDossier(r.steamId64),
      })),
    );

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

const searchTool: ToolDefinition = {
  name: "cs_search",
  description: "Search CSRep for players by name. Requires CSREP_API_KEY. Returns candidate Steam IDs.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Player name to search." },
    },
    required: ["query"],
  },
  handler: async (input) => {
    if (!aggregator.csrep) {
      throw new UserError("CSRep search needs CSREP_API_KEY in the bot environment.");
    }
    const query = String(input.query ?? "").trim();
    if (!query) throw new UserError("query is required.");
    const results = await aggregator.csrep.search(query);
    return { query, results };
  },
};

const refreshTool: ToolDefinition = {
  name: "cs_refresh",
  description: "Request a CSRep profile refresh, then return a fresh merged dossier.",
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
    if (aggregator.csrep) {
      await aggregator.csrep.refresh(steamId64);
    }
    const dossier = await aggregator.fetchDossier(steamId64, { bypassCache: true });
    return { refreshed: Boolean(aggregator.csrep), dossier };
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
    compareTool,
    searchTool,
    refreshTool,
    leaderboardTool,
  ],
  start: async () => {
    await links.load();
    const providers = [
      config.csrepApiKey ? "csrep" : null,
      config.csstEnabled ? "csst" : null,
      config.cstrackerEnabled ? "cstracker" : null,
      config.faceitApiKey ? "faceit" : null,
      config.steamWebApiKey ? "steam" : null,
    ].filter(Boolean);
    console.log(`[cs-tracker] ready; providers: ${providers.join(", ") || "(none configured)"}`);
  },
  stop: async () => {
    await links.flush();
  },
};
