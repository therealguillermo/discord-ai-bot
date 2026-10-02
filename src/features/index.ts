import type { Client } from "discord.js";
import type { ToolDefinition } from "../tools/types.js";
import { csTrackerFeature } from "./cs-tracker/index.js";
import { economyFeature } from "./economy/index.js";
import { gamesFeature } from "./games/index.js";
import { imagesFeature } from "./images/index.js";
import { moderationFeature } from "./moderation/index.js";
import { musicFeature } from "./music/index.js";
import type { Feature } from "./types.js";

/** Order matters: the economy must load before anything that spends coins. */
export const features: Feature[] = [
  economyFeature,
  gamesFeature,
  moderationFeature,
  imagesFeature,
  musicFeature,
  csTrackerFeature,
];

/** Tools contributed by features, appended to the agent's toolbox. */
export const featureTools: ToolDefinition[] = features.flatMap((f) => f.tools ?? []);

export async function startFeatures(client: Client<true>): Promise<void> {
  for (const feature of features) {
    try {
      await feature.start?.(client);
    } catch (err) {
      // A broken optional feature must not take the whole bot down, but the economy is critical.
      console.error(`[features] ${feature.name} failed to start:`, err);
      if (feature === economyFeature) throw err;
    }
  }
}

export async function stopFeatures(): Promise<void> {
  for (const feature of [...features].reverse()) {
    try {
      await feature.stop?.();
    } catch (err) {
      console.error(`[features] ${feature.name} failed to stop:`, err);
    }
  }
}
