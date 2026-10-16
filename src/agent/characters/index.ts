import { clarence } from "./clarence.js";
import { donny } from "./donny.js";
import { mike } from "./mike.js";
import { sassy } from "./sassy.js";
import type { Character, CharacterId } from "./types.js";

/**
 * One file per character. Next agent: read the comment at the top of the file.
 *   sassy.ts     locked original personality toward users
 *   donny.ts     user-supplied profile
 *   clarence.ts  PENDING — paste the user's Clarence writeup
 *   mike.ts      PENDING — paste the user's Mike Nolan writeup
 *
 * Departments are not assigned here. The user will define who owns which jobs.
 */
export const characters: Record<CharacterId, Character> = {
  sassy,
  donny,
  clarence,
  mike,
};

export function getCharacter(id: CharacterId): Character {
  return characters[id];
}

export type { Character, CharacterId, ProfileStatus } from "./types.js";
export { PROFILE_PENDING } from "./types.js";
