import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DiscordAPIError } from "@discordjs/rest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { config } from "../config.js";
import { classifyRisk } from "../safety/confirm.js";
import { DISCORD_INTENT_ALIASES } from "./discordAliases.js";
import type { Endpoint, EndpointRegistry, JsonSchema } from "./endpointTypes.js";
import type { ToolContext, ToolDefinition } from "./types.js";

/* -------------------------------------------------------------------------- */
/* Registry loading                                                           */
/* -------------------------------------------------------------------------- */

const here = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.join(here, "generated", "endpoints.json");

function loadRegistry(): EndpointRegistry {
  try {
    return JSON.parse(readFileSync(registryPath, "utf8")) as EndpointRegistry;
  } catch {
    throw new Error(
      `Endpoint registry not found at ${registryPath}. Run "npm run gen:endpoints" first.`,
    );
  }
}

const registry = loadRegistry();
const byOperationId = new Map<string, Endpoint>(registry.endpoints.map((e) => [e.operationId, e]));

/** Operations the agent may never call, regardless of confirmation. */
const BLOCKED_OPERATIONS = new Set([
  "leave_guild", // would remove the bot from the server
  "create_dm", // prevents arbitrary DM spam
  "add_group_dm_user",
  "delete_group_dm_user",
]);

/** Path parameters that are always pinned to this bot's own guild/application. */
const PINNED_PARAMS: Record<string, string> = {
  guild_id: config.guildId,
  application_id: config.appId,
};

/* -------------------------------------------------------------------------- */
/* Schema validation (Ajv)                                                    */
/* -------------------------------------------------------------------------- */

const REGISTRY_ID = "https://discord-bot-agent.local/registry";
const REF_FROM = "#/components/schemas/";
const REF_TO = `${REGISTRY_ID}#/components/schemas/`;

function rewriteRefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map(rewriteRefs) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = k === "$ref" && typeof v === "string" && v.startsWith(REF_FROM)
        ? REF_TO + v.slice(REF_FROM.length)
        : rewriteRefs(v);
    }
    return out as T;
  }
  return value;
}

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
ajv.addSchema({ $id: REGISTRY_ID, components: { schemas: rewriteRefs(registry.schemas) } });

type Validator = (data: unknown) => string | null;
const validatorCache = new Map<string, Validator | null>();

function buildValidator(key: string, schema: JsonSchema): Validator | null {
  if (validatorCache.has(key)) return validatorCache.get(key) ?? null;
  let validator: Validator | null = null;
  try {
    const validate = ajv.compile(rewriteRefs(schema));
    validator = (data) => {
      if (validate(data)) return null;
      const text = ajv.errorsText(validate.errors, { dataVar: "input", separator: "; " });
      return text.length > 800 ? `${text.slice(0, 800)}...` : text;
    };
  } catch (err) {
    console.warn(`[discord_call] Could not compile schema for ${key}; skipping validation.`, err);
  }
  validatorCache.set(key, validator);
  return validator;
}

/* -------------------------------------------------------------------------- */
/* Schema rendering (compact, token-efficient)                                */
/* -------------------------------------------------------------------------- */

function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

function renderSchema(schema: JsonSchema | undefined, depth: number, stack: string[] = []): string {
  if (!schema || typeof schema !== "object") return "any";

  const ref = schema["$ref"];
  if (typeof ref === "string") {
    const name = refName(ref);
    if (name === "SnowflakeType") return "snowflake(string)";
    const target = registry.schemas[name];
    if (!target || depth <= 0 || stack.includes(name)) return name;
    return renderSchema(target, depth - 1, [...stack, name]);
  }

  const title = typeof schema.title === "string" ? schema.title : undefined;
  if ("const" in schema) {
    const c = JSON.stringify(schema.const);
    return title ? `${c} (${title})` : c;
  }
  if (Array.isArray(schema.enum)) {
    return (schema.enum as unknown[]).slice(0, 20).map((v) => JSON.stringify(v)).join("|");
  }

  for (const key of ["oneOf", "anyOf"] as const) {
    const variants = schema[key];
    if (Array.isArray(variants)) {
      const shown = (variants as JsonSchema[]).slice(0, 12).map((v) => renderSchema(v, depth, stack));
      if (variants.length > 12) shown.push(`...(${variants.length - 12} more)`);
      return shown.join(" | ");
    }
  }
  if (Array.isArray(schema.allOf)) {
    return (schema.allOf as JsonSchema[]).map((v) => renderSchema(v, depth, stack)).join(" & ");
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    const nonNull = (type as string[]).filter((t) => t !== "null");
    const parts = nonNull.map((t) => renderSchema({ ...schema, type: t }, depth, stack));
    if (nonNull.length !== type.length) parts.push("null");
    return parts.join(" | ");
  }

  const constraints: string[] = [];
  if (typeof schema.minimum === "number") constraints.push(`>=${schema.minimum}`);
  if (typeof schema.maximum === "number") constraints.push(`<=${schema.maximum}`);
  if (typeof schema.minLength === "number") constraints.push(`len>=${schema.minLength}`);
  if (typeof schema.maxLength === "number") constraints.push(`len<=${schema.maxLength}`);
  if (typeof schema.maxItems === "number") constraints.push(`max ${schema.maxItems} items`);
  const suffix = constraints.length ? `(${constraints.join(", ")})` : "";

  switch (type) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
    case "null":
      return `${type}${suffix}`;
    case "array": {
      const item = renderSchema(schema.items as JsonSchema, depth, stack);
      return `${item.includes(" | ") || item.includes(" & ") ? `(${item})` : item}[]${suffix}`;
    }
    case "object":
    default: {
      const props = schema.properties as Record<string, JsonSchema> | undefined;
      const additional = schema.additionalProperties;
      if (!props && additional && typeof additional === "object") {
        return `{ [key: string]: ${renderSchema(additional as JsonSchema, depth, stack)} }`;
      }
      if (!props) return type === "object" ? "object" : "any";
      const required = new Set((schema.required as string[] | undefined) ?? []);
      const entries = Object.entries(props).map(
        ([k, v]) => `${k}${required.has(k) ? "" : "?"}: ${renderSchema(v, depth, stack)}`,
      );
      return `{ ${entries.join("; ")} }`;
    }
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated, ${text.length - max} more chars]` : text;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

function endpointRisk(e: Endpoint): "safe" | "destructive" {
  return classifyRisk(e.method, e.path);
}

function briefLine(e: Endpoint): string {
  const params = e.params.map((p) => `${p.name}${p.required ? "*" : ""}`).join(", ");
  const flags = [
    e.body ? `body${e.body.required ? "*" : ""}` : null,
    e.multipartOnly ? "multipart-only(unsupported)" : null,
    BLOCKED_OPERATIONS.has(e.operationId) ? "BLOCKED" : null,
    endpointRisk(e) === "destructive" ? "needs-confirmation" : null,
  ].filter(Boolean);
  return `${e.operationId} | ${e.method} ${e.path} | params: ${params || "-"}${flags.length ? ` | ${flags.join(", ")}` : ""}`;
}

function detailOf(e: Endpoint): string {
  const lines = [`${e.operationId}: ${e.method} ${e.path}`];
  if (BLOCKED_OPERATIONS.has(e.operationId)) lines.push("BLOCKED: this operation cannot be called.");
  if (e.multipartOnly) lines.push("Unsupported: this operation only accepts multipart/form-data uploads.");
  if (classifyRisk(e.method, e.path) === "destructive") {
    lines.push("Requires human confirmation before running.");
  }
  if (e.params.length) {
    lines.push("Params (pass inside `params`; * = required; guild_id and application_id are filled automatically):");
    for (const p of e.params) {
      lines.push(`  - ${p.name}${p.required ? "*" : ""} [${p.in}]: ${renderSchema(p.schema, 2)}`);
    }
  }
  if (e.body) {
    lines.push(`Body${e.body.required ? " (required)" : " (optional)"}:`);
    lines.push(`  ${clip(renderSchema(e.body.schema, 2), 5000)}`);
    lines.push(
      "Bare capitalized names (e.g. ButtonStyleTypes) are nested types: look them up with the `schema` argument.",
    );
  }
  return lines.join("\n");
}

function search(query: string, limit = 15): Endpoint[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
  if (tokens.length === 0) return [];

  // Natural-language intents (mute, ban, purge, …) → boost the matching operation_ids.
  const aliasBoost = new Map<string, number>();
  for (const t of tokens) {
    const ops = DISCORD_INTENT_ALIASES[t];
    if (!ops) continue;
    for (const op of ops) {
      if (!byOperationId.has(op)) continue; // skip curated-only names like timeout_member
      aliasBoost.set(op, (aliasBoost.get(op) ?? 0) + 8);
    }
  }

  const scored = registry.endpoints
    .map((e) => {
      const id = e.operationId.toLowerCase();
      const idWords = new Set(id.split("_").map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)));
      const route = e.path.toLowerCase();
      let score = aliasBoost.get(e.operationId) ?? 0;
      for (const t of tokens) {
        if (idWords.has(t)) score += 3;
        else if (id.includes(t)) score += 2;
        if (route.includes(t)) score += 1;
        if (e.method.toLowerCase() === t) score += 1;
      }
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.operationId.localeCompare(b.e.operationId));

  return scored.slice(0, limit).map((x) => x.e);
}

/* -------------------------------------------------------------------------- */
/* Guild scoping                                                              */
/* -------------------------------------------------------------------------- */

const channelGuildCache = new Map<string, string | null>();

async function assertChannelInGuild(channelId: string, ctx: ToolContext): Promise<void> {
  let guildId = channelGuildCache.get(channelId);
  if (guildId === undefined) {
    try {
      const channel = await ctx.client.channels.fetch(channelId);
      guildId = channel && "guildId" in channel && channel.guildId ? channel.guildId : null;
    } catch {
      // Let Discord report not-found / missing-access itself.
      return;
    }
    channelGuildCache.set(channelId, guildId);
  }
  if (guildId !== ctx.guildId) {
    throw new Error(`Channel ${channelId} does not belong to the configured server.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_RESULT_CHARS = 14_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface CallOptions {
  operationId: string;
  params?: Record<string, unknown>;
  body?: unknown;
  /** Extra context shown in the confirmation prompt (e.g. which member). */
  confirmNote?: string;
  /** Audit-log reason recorded by Discord (X-Audit-Log-Reason). */
  reason?: string;
}

/**
 * Validate, scope, risk-check, and execute a Discord REST operation.
 * Used by both the generic discord_call tool and the curated tools.
 */
export async function callOperation(opts: CallOptions, ctx: ToolContext): Promise<unknown> {
  const endpoint = byOperationId.get(opts.operationId);
  if (!endpoint) {
    throw new Error(
      `Unknown operation_id "${opts.operationId}". Use discord_search_endpoints to find valid IDs.`,
    );
  }
  if (BLOCKED_OPERATIONS.has(endpoint.operationId)) {
    throw new Error(`Operation ${endpoint.operationId} is blocked and cannot be called.`);
  }
  if (endpoint.multipartOnly) {
    throw new Error(`Operation ${endpoint.operationId} only supports file uploads, which are not supported.`);
  }

  const params: Record<string, unknown> = { ...(opts.params ?? {}) };
  const known = new Set(endpoint.params.map((p) => p.name));
  const unknown = Object.keys(params).filter((k) => !known.has(k));
  if (unknown.length) {
    throw new Error(
      `Unknown param(s) for ${endpoint.operationId}: ${unknown.join(", ")}. Valid: ${[...known].join(", ") || "(none)"}.`,
    );
  }

  // Pin guild/application scope.
  for (const p of endpoint.params) {
    const pinned = PINNED_PARAMS[p.name];
    if (pinned === undefined || p.in !== "path") continue;
    const given = params[p.name];
    if (given !== undefined && String(given) !== pinned && String(given) !== "@me") {
      throw new Error(`${p.name} must be ${pinned} (the configured server/app); got ${String(given)}.`);
    }
    params[p.name] = pinned;
  }

  // Required params + schema validation.
  const missing = endpoint.params.filter((p) => p.required && params[p.name] === undefined).map((p) => p.name);
  if (missing.length) throw new Error(`Missing required param(s): ${missing.join(", ")}.`);

  if (endpoint.params.length) {
    const paramSchema: JsonSchema = {
      type: "object",
      properties: Object.fromEntries(endpoint.params.map((p) => [p.name, p.schema])),
    };
    const validate = buildValidator(`${endpoint.operationId}:params`, paramSchema);
    const error = validate?.(params);
    if (error) throw new Error(`Invalid params: ${error}`);
  }

  if (opts.body !== undefined && !endpoint.body) {
    throw new Error(`${endpoint.operationId} does not accept a request body.`);
  }
  if (endpoint.body) {
    if (opts.body === undefined) {
      if (endpoint.body.required) throw new Error(`${endpoint.operationId} requires a body.`);
    } else {
      const validate = buildValidator(`${endpoint.operationId}:body`, endpoint.body.schema);
      const error = validate?.(opts.body);
      if (error) throw new Error(`Invalid body: ${error}`);
    }
  }

  // Channel-scoped paths must belong to our guild.
  if (typeof params.channel_id === "string" || typeof params.channel_id === "number") {
    await assertChannelInGuild(String(params.channel_id), ctx);
  }

  // Build the concrete route and query string.
  const route = endpoint.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(String(params[name])),
  );
  const query = new URLSearchParams();
  for (const p of endpoint.params) {
    if (p.in !== "query") continue;
    const value = params[p.name];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => query.append(p.name, String(v)));
    else query.append(p.name, String(value));
  }

  // Human confirmation for risky calls.
  if (classifyRisk(endpoint.method, endpoint.path, opts.body) === "destructive") {
    const bodyText = opts.body === undefined ? "" : `\nbody: ${JSON.stringify(opts.body).slice(0, 600)}`;
    const note = opts.confirmNote ? `\n${opts.confirmNote}` : "";
    const approved = await ctx.confirm(`${endpoint.method} ${route}${bodyText}${note}`);
    if (!approved) {
      throw new Error("The requester declined or did not respond to the confirmation. Action was not performed.");
    }
  }

  try {
    const data = await ctx.rest.request({
      method: endpoint.method as any,
      fullRoute: route as `/${string}`,
      query: query.toString() ? query : undefined,
      body: opts.body === undefined ? undefined : (opts.body as object),
      reason: `Claude agent (requested by ${ctx.requesterId})${opts.reason ? `: ${opts.reason}` : ""}`.slice(0, 480),
    });
    const text = JSON.stringify(data ?? null);
    return text.length > MAX_RESULT_CHARS
      ? { truncated: true, note: "Result was too large; narrow the request (limit/before/after).", preview: text.slice(0, MAX_RESULT_CHARS) }
      : (data ?? { ok: true });
  } catch (err) {
    if (err instanceof DiscordAPIError) {
      const raw = isRecord(err.rawError) ? JSON.stringify(err.rawError).slice(0, 800) : "";
      throw new Error(`Discord API error ${err.status} (code ${err.code}): ${err.message} ${raw}`.trim());
    }
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Tool definitions                                                           */
/* -------------------------------------------------------------------------- */

export const discordSearchEndpoints: ToolDefinition = {
  name: "discord_search_endpoints",
  description:
    "Search the full Discord REST API (about 240 operations) by keyword and get exact parameter/body schemas. " +
    "Prefer load_skill name=\"discord-api\" topic=\"…\" first for common admin intents (mute, ban, purge, …); " +
    "use this when you need the live schema or an uncommon operation. Provide `query` to find operations " +
    "(e.g. \"create webhook\", \"list scheduled events\"), `operation_id` for full parameter and body details of one " +
    "operation, or `schema` for details of a named nested type.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keywords, e.g. 'timeout member' or 'forum thread'." },
      operation_id: { type: "string", description: "Exact operation ID to describe in full." },
      schema: { type: "string", description: "Name of a nested schema type to expand in detail." },
    },
  },
  async handler(input) {
    const operationId = typeof input.operation_id === "string" ? input.operation_id : undefined;
    const schemaName = typeof input.schema === "string" ? input.schema : undefined;
    const query = typeof input.query === "string" ? input.query : undefined;

    if (operationId) {
      const e = byOperationId.get(operationId);
      if (!e) throw new Error(`Unknown operation_id "${operationId}".`);
      return detailOf(e);
    }
    if (schemaName) {
      const s = registry.schemas[schemaName];
      if (!s) throw new Error(`Unknown schema "${schemaName}".`);
      return clip(renderSchema(s, 4), 8000);
    }
    if (query) {
      const results = search(query);
      if (!results.length) return "No matching operations. Try different or broader keywords.";
      return `${results.length} match(es) (name | route | params; * = required):\n${results.map(briefLine).join("\n")}`;
    }
    throw new Error("Provide one of: query, operation_id, schema.");
  },
};

export const discordCall: ToolDefinition = {
  name: "discord_call",
  description:
    "Call any Discord REST API operation by operation_id. First find the operation and its schema with " +
    "discord_search_endpoints. Put path and query parameters in `params` and the JSON request body in `body`. " +
    "guild_id and application_id are filled in automatically. Destructive operations (deletes, bans, role and " +
    "permission changes) pause for human confirmation. Prefer the dedicated tools when one fits.",
  input_schema: {
    type: "object",
    properties: {
      operation_id: { type: "string", description: "Operation ID from discord_search_endpoints." },
      params: { type: "object", description: "Path and query parameters keyed by name." },
      body: { type: "object", description: "JSON request body, if the operation takes one." },
    },
    required: ["operation_id"],
  },
  async handler(input, ctx) {
    if (typeof input.operation_id !== "string") throw new Error("operation_id is required.");
    return callOperation(
      {
        operationId: input.operation_id,
        params: isRecord(input.params) ? input.params : undefined,
        body: input.body,
      },
      ctx,
    );
  },
};

export function endpointCount(): number {
  return registry.endpoints.length;
}
