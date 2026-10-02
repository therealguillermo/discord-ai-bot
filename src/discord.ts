import { Client, GatewayIntentBits, Partials } from "discord.js";
import { REST } from "@discordjs/rest";
import { config } from "./config.js";

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // privileged
      GatewayIntentBits.GuildVoiceStates, // voice pay + music
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // privileged
    ],
    partials: [Partials.Channel, Partials.Message],
  });
}

/** Standalone REST client used by tools. Handles rate limits and retries internally. */
export function createRest(): REST {
  return new REST({ version: "10" }).setToken(config.discordToken);
}
