import { AudioPlayerStatus } from "@discordjs/voice";

/** Buffering already means the track was accepted and audio is on the way. */
export function trackIsPlaying(playerStatus: string | undefined, hasCurrent: boolean): boolean {
  if (playerStatus === AudioPlayerStatus.Playing) return true;
  return hasCurrent && playerStatus === AudioPlayerStatus.Buffering;
}
