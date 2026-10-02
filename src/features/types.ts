import type { Client, Message, MessageReplyOptions } from "discord.js";
import type { ToolDefinition } from "../tools/types.js";

/** Throw from a command to show a friendly message to the user (not logged as an error). */
export class UserError extends Error {}

export interface CommandContext {
  client: Client;
  message: Message<true>;
  /** Arguments after the command name, split on whitespace. */
  args: string[];
  /** Everything after the command name, unsplit. */
  rest: string;
  prefix: string;
  /** Reply to the invoking message. Never pings anyone unless allowedMentions is overridden. */
  reply: (content: string | MessageReplyOptions) => Promise<Message<true>>;
}

export interface PrefixCommand {
  name: string;
  aliases?: string[];
  description: string;
  /** Shown in ?help, e.g. "<bet|all>". */
  usage?: string;
  cooldownMs?: number;
  execute: (ctx: CommandContext) => Promise<void>;
}

/** A self-contained slice of functionality: prefix commands, agent tools, and a lifecycle. */
export interface Feature {
  name: string;
  commands?: PrefixCommand[];
  /** Tools exposed to the Claude agent. */
  tools?: ToolDefinition[];
  /** Called once the client is ready and the guild has been verified. */
  start?: (client: Client<true>) => void | Promise<void>;
  /** Called on shutdown; flush state here. */
  stop?: () => void | Promise<void>;
}
