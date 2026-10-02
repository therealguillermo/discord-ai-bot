/** Loose JSON Schema node as found in Discord's OpenAPI spec. */
export type JsonSchema = Record<string, unknown>;

export interface EndpointParam {
  name: string;
  in: "path" | "query";
  required: boolean;
  schema: JsonSchema;
}

export interface Endpoint {
  operationId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** OpenAPI-style path, e.g. /channels/{channel_id}/messages */
  path: string;
  params: EndpointParam[];
  /** JSON request body, if the operation accepts one. */
  body?: { required: boolean; schema: JsonSchema };
  /** True when the operation only accepts multipart uploads (unsupported by discord_call). */
  multipartOnly?: boolean;
}

export interface EndpointRegistry {
  source: string;
  generatedAt: string;
  endpoints: Endpoint[];
  /** components.schemas entries reachable from request bodies and parameters. */
  schemas: Record<string, JsonSchema>;
}
