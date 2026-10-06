import type Anthropic from "@anthropic-ai/sdk";
import type { Client } from "discord.js";
import type { REST } from "@discordjs/rest";

/** Everything a tool handler needs to act on Discord on behalf of a requester. */
export interface ToolContext {
  client: Client;
  rest: REST;
  guildId: string;
  requesterId: string;
  /**
   * Owner or an allowed admin. Required for moderation and any Discord change
   * (channels, roles, permissions, kicks, bans, timeouts, sending or deleting messages).
   */
  discordControl: boolean;
  channelId: string;
  /** The message that triggered this request (absent for slash commands). Used so "purge" skips it. */
  triggerMessageId?: string;
  /** Ask the requester to approve a destructive action. Resolves false if denied/timeout. */
  confirm: (summary: string) => Promise<boolean>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  /** If true the dispatcher asks for confirmation before running the handler. */
  destructive?: boolean;
  /** If true, only discord controllers (owner / allowed admins) may run this tool. */
  requiresDiscordControl?: boolean;
  /** Human-readable one-liner used in confirmation prompts. */
  describeAction?: (input: Record<string, unknown>) => string;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}
