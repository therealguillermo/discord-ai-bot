export type CharacterId = "sassy" | "donny" | "clarence" | "mike";

/**
 * locked   — Sassy. Original personality toward users. Do not rewrite voice or offJob.
 * supplied — Donny. The user's writeup is already in this file. Do not replace it.
 * pending  — Clarence and Mike Nolan. Paste the user's writeup into voice and offJob.
 */
export type ProfileStatus = "locked" | "supplied" | "pending";

/** Keep this exact string in a profile until the user's writeup replaces voice and offJob. */
export const PROFILE_PENDING =
  "PROFILE PENDING — paste the user's character writeup into this file. Do not invent a personality.";

export interface Character {
  id: CharacterId;
  /** Name used in the system prompt. */
  name: string;
  /** Env var that holds this bot's Discord token. */
  tokenEnv: "SASSYTHESASQUATCH" | "DONNYTHEDEALER" | "CLARENCE" | "MIKENOLAN";
  profile: ProfileStatus;
  /** Body of "Who you are", after the shared first-person rule. */
  voice: string;
  /** How an off-job insult is delivered. The shared rules still decide when. */
  offJob: string;
}
