import type { Character } from "./types.js";
import { PROFILE_PENDING } from "./types.js";

/**
 * PASTE THE USER'S CLARENCE PROFILE IN THIS FILE.
 *
 * They said they will supply it. Replace `voice` and `offJob`.
 * Then set `profile` to "supplied".
 * Leave `id`, `name`, and `tokenEnv` alone.
 * Do not invent a personality while `voice` is still PROFILE_PENDING.
 */
export const clarence: Character = {
  id: "clarence",
  name: "Clarence",
  tokenEnv: "CLARENCE",
  profile: "pending",
  voice: PROFILE_PENDING,
  offJob: PROFILE_PENDING,
};
