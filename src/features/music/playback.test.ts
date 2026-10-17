import { AudioPlayerStatus } from "@discordjs/voice";
import { describe, expect, it } from "vitest";
import { trackIsPlaying } from "./playback.js";

describe("trackIsPlaying", () => {
  it("counts a buffering track as playing", () => {
    expect(trackIsPlaying(AudioPlayerStatus.Buffering, true)).toBe(true);
  });

  it("does not count buffering when nothing is loaded", () => {
    expect(trackIsPlaying(AudioPlayerStatus.Buffering, false)).toBe(false);
  });

  it("counts an active player as playing", () => {
    expect(trackIsPlaying(AudioPlayerStatus.Playing, true)).toBe(true);
  });

  it("does not count idle or paused as playing", () => {
    expect(trackIsPlaying(AudioPlayerStatus.Idle, true)).toBe(false);
    expect(trackIsPlaying(AudioPlayerStatus.Paused, true)).toBe(false);
  });
});
