import { Client, GatewayIntentBits, Partials } from "discord.js";
import { REST } from "@discordjs/rest";
import { config } from "./config.js";

export type ClientKind = "operator" | "music" | "chat";

export interface ClientIntentOptions {
  /** Privileged. Default true. */
  messageContent?: boolean;
  /** Privileged. Default true for operator, false otherwise. */
  guildMembers?: boolean;
}

/**
 * operator: Sassy / Nolzy — members + message content by default.
 * music: Clarence — voice states, not server members.
 * chat: Donny — guild messages only (plus message content when allowed).
 */
export function createDiscordClient(kind: ClientKind = "operator", opts: ClientIntentOptions = {}): Client {
  const messageContent = opts.messageContent ?? true;
  const guildMembers = opts.guildMembers ?? kind === "operator";
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (messageContent) intents.push(GatewayIntentBits.MessageContent);
  if (guildMembers) intents.push(GatewayIntentBits.GuildMembers);
  if (kind === "operator" || kind === "music") intents.push(GatewayIntentBits.GuildVoiceStates);
  return new Client({
    intents,
    partials: [Partials.Channel, Partials.Message],
  });
}

/** Standalone REST client used by tools. Handles rate limits and retries internally. */
export function createRest(token = config.discordToken): REST {
  return new REST({ version: "10" }).setToken(token);
}
