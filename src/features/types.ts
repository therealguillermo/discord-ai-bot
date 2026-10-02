import type { Client } from "discord.js";
import type { ToolDefinition } from "../tools/types.js";

/** Throw from feature code to show a friendly message to the user (not logged as an error). */
export class UserError extends Error {}

/** A self-contained slice of functionality: agent tools and a lifecycle. */
export interface Feature {
  name: string;
  /** Tools exposed to the Claude agent. */
  tools?: ToolDefinition[];
  /** Called once the client is ready and the guild has been verified. */
  start?: (client: Client<true>) => void | Promise<void>;
  /** Called on shutdown; flush state here. */
  stop?: () => void | Promise<void>;
}
