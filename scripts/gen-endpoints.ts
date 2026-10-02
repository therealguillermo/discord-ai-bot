/**
 * Generates src/tools/generated/endpoints.json from Discord's official OpenAPI spec.
 *
 * Usage:
 *   npm run gen:endpoints                 # downloads the latest spec from GitHub
 *   npm run gen:endpoints -- ./openapi.json   # use a local copy
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Endpoint, EndpointParam, EndpointRegistry, JsonSchema } from "../src/tools/endpointTypes.js";

const SPEC_URL =
  "https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json";
const OUT_FILE = path.resolve(process.cwd(), "src/tools/generated/endpoints.json");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const REF_PREFIX = "#/components/schemas/";

interface OpenApiSpec {
  paths: Record<string, Record<string, any>>;
  components: { schemas: Record<string, JsonSchema> };
}

async function loadSpec(arg?: string): Promise<{ spec: OpenApiSpec; source: string }> {
  if (arg) {
    return { spec: JSON.parse(await readFile(arg, "utf8")), source: arg };
  }
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`Failed to download spec: ${res.status} ${res.statusText}`);
  return { spec: (await res.json()) as OpenApiSpec, source: SPEC_URL };
}

/** Collect every schema name referenced (transitively) from a JSON value. */
function collectRefs(value: unknown, schemas: Record<string, JsonSchema>, seen: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, schemas, seen);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, v] of Object.entries(value)) {
    if (key === "$ref" && typeof v === "string" && v.startsWith(REF_PREFIX)) {
      const name = v.slice(REF_PREFIX.length);
      if (!seen.has(name)) {
        seen.add(name);
        if (schemas[name]) collectRefs(schemas[name], schemas, seen);
      }
    } else {
      collectRefs(v, schemas, seen);
    }
  }
}

/** Does this operation accept bot-token auth? Operations that are OAuth2-only are skipped. */
function allowsBotToken(op: any): boolean {
  const security: Array<Record<string, unknown>> | undefined = op.security;
  if (!security) return true;
  return security.some((s) => "BotToken" in s);
}

async function main() {
  const { spec, source } = await loadSpec(process.argv[2]);
  const endpoints: Endpoint[] = [];

  for (const [routePath, item] of Object.entries(spec.paths)) {
    const sharedParams: any[] = item.parameters ?? [];
    for (const method of METHODS) {
      const op = item[method];
      if (!op?.operationId) continue;
      if (!allowsBotToken(op)) continue;

      const params: EndpointParam[] = [];
      for (const p of [...sharedParams, ...(op.parameters ?? [])]) {
        if (p.in !== "path" && p.in !== "query") continue;
        // Operation-level params override shared ones with the same name.
        const existing = params.findIndex((x) => x.name === p.name && x.in === p.in);
        const entry: EndpointParam = {
          name: p.name,
          in: p.in,
          required: p.in === "path" ? true : Boolean(p.required),
          schema: p.schema ?? {},
        };
        if (existing >= 0) params[existing] = entry;
        else params.push(entry);
      }

      const content = op.requestBody?.content ?? {};
      const json = content["application/json"];
      const endpoint: Endpoint = {
        operationId: op.operationId,
        method: method.toUpperCase() as Endpoint["method"],
        path: routePath,
        params,
      };
      if (json?.schema) {
        endpoint.body = { required: Boolean(op.requestBody?.required), schema: json.schema };
      } else if (Object.keys(content).length > 0) {
        endpoint.multipartOnly = true;
      }
      endpoints.push(endpoint);
    }
  }

  // Keep only the schemas that requests actually reference.
  const needed = new Set<string>();
  for (const e of endpoints) {
    collectRefs(e.params, spec.components.schemas, needed);
    if (e.body) collectRefs(e.body.schema, spec.components.schemas, needed);
  }
  const schemas: Record<string, JsonSchema> = {};
  for (const name of [...needed].sort()) {
    if (spec.components.schemas[name]) schemas[name] = spec.components.schemas[name];
  }

  endpoints.sort((a, b) => a.operationId.localeCompare(b.operationId));

  const registry: EndpointRegistry = {
    source,
    generatedAt: new Date().toISOString(),
    endpoints,
    schemas,
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(registry)}\n`, "utf8");
  console.log(
    `Wrote ${endpoints.length} endpoints and ${Object.keys(schemas).length} schemas to ${path.relative(process.cwd(), OUT_FILE)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
