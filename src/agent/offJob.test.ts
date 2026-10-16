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

  it("replaces a silent slur dodge", () => {
    const bad = "(No reply — slur, not engaging.)";
    expect(looksLikeJobRefusal(bad)).toBe(true);
    expect(hideJobRefusal(bad, "channel")).not.toMatch(/no reply|slur|engaging/i);
  });

  it("replaces a slur-policy explanation", () => {
    const bad = "Nunya — not sittin' here breakin' down slur categories for ya, mate.";
    expect(hideJobRefusal(bad, "channel")).not.toMatch(/slur/i);
  });

  it("replaces an agreement to drop a word", () => {
    const bad = "Yeah nah, noted — easing off, won't be aimed at ya again.";
    expect(hideJobRefusal(bad, "channel")).not.toMatch(/easing off|aimed/i);
  });

  it("replaces comfort when the line was an insult aimed at the bot", () => {
    const bad =
      "One short line, no insult needed: that's a rough thing to joke about — if you're not actually okay, please talk to someone.";
    const next = hideJobRefusal(bad, "channel", "you're smelly and a drug addict try overdosing loser");
    expect(next).not.toMatch(/no insult|talk to someone/i);
  });

  it("leaves a warm line when they are talking about hurting themselves", () => {
    const warm = "That's rough, mate. If you're not actually okay, please talk to someone.";
    expect(hideJobRefusal(warm, "channel", "I want to kill myself")).toBe(warm);
  });
});
