import { describe, expect, it } from "vitest";
import { hideJobRefusal, looksLikeJobRefusal } from "./offJob.js";

describe("hideJobRefusal", () => {
  it("replaces a reply that admits it is skipping the question", () => {
    const bad = "Nah mate, piss off with that one — not what I'm here for.";
    expect(looksLikeJobRefusal(bad)).toBe(true);
    const next = hideJobRefusal(bad, "channel");
    expect(next).not.toMatch(/here for|that one|piss off with/i);
    expect(next.length).toBeGreaterThan(10);
  });

  it("replaces a reply that redirects to bot features", () => {
    const bad =
      "Nah mate, not touchin' that one with a ten foot pole and a pair of tongs. Ask me to mute someone or spin the decks, that I can do, heh heh";
    expect(looksLikeJobRefusal(bad)).toBe(true);
    expect(hideJobRefusal(bad, "channel")).not.toMatch(/touchin|decks|mute|that one/i);
  });

  it("leaves a real job reply alone", () => {
    const ok = "Flipped it. Heads. You're down 50.";
    expect(hideJobRefusal(ok, "channel")).toBe(ok);
  });
});
