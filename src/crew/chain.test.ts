import { describe, expect, it } from "vitest";
import { CREW_CHAIN_CAP, resetCrewChain, takeCrewTurn } from "./chain.js";

describe("crew chain", () => {
  it("stops bot-to-bot replies after the cap, then starts over when a person speaks", () => {
    resetCrewChain("channel-a");
    for (let i = 0; i < CREW_CHAIN_CAP; i++) expect(takeCrewTurn("channel-a")).toBe(true);
    expect(takeCrewTurn("channel-a")).toBe(false);
    resetCrewChain("channel-a");
    expect(takeCrewTurn("channel-a")).toBe(true);
  });

  it("keeps channels separate", () => {
    resetCrewChain("channel-b");
    resetCrewChain("channel-c");
    expect(takeCrewTurn("channel-b", 1)).toBe(true);
    expect(takeCrewTurn("channel-b", 1)).toBe(false);
    expect(takeCrewTurn("channel-c", 1)).toBe(true);
  });
});
