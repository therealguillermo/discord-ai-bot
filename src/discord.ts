import { Client, GatewayIntentBits, Partials } from "discord.js";
import { REST } from "@discordjs/rest";
import { config } from "./config.js";

/**
 * operator: Sassy (members, voice, and message content by default).
 * chat: the other personalities. Pass messageContent false to skip that privileged intent.
 */
export function createDiscordClient(kind: "operator" | "chat" = "operator", messageContent = true): Client {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (messageContent) intents.push(GatewayIntentBits.MessageContent);
  if (kind === "operator") {
    intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates);
  }
  return new Client({
    intents,
    partials: [Partials.Channel, Partials.Message],
  });
}

/** Standalone REST client used by tools. Handles rate limits and retries internally. */
export function createRest(token = config.discordToken): REST {
  return new REST({ version: "10" }).setToken(token);
}
