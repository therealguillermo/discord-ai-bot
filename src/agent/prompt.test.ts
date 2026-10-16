import { describe, expect, it } from "vitest";
import { characters, PROFILE_PENDING } from "./characters/index.js";
import { buildSystemPrompt } from "./prompt.js";

const base = {
  guildName: "Test",
  guildId: "100000000000000001",
  botName: "Bot",
  ownerId: "100000000000000002",
};

describe("character voices", () => {
  it("keeps Sassy's original voice toward users", () => {
    const prompt = buildSystemPrompt({ ...base, character: "sassy" });
    expect(prompt).toContain("You are Sassy the Sasquatch");
    expect(prompt).toContain("surfer drawl");
    expect(prompt).toContain("your only job is this server: music, coins, blackjack");
    expect(prompt).toContain("A real server request in the same message still gets done. If they also wandered off the job");
    expect(prompt).not.toContain("## The crew");
    expect(prompt).toContain(characters.sassy.offJob);
    expect(characters.sassy.profile).toBe("locked");
  });

  it("gives Donny the shop voice and no real counter", () => {
    const prompt = buildSystemPrompt({ ...base, character: "donny" });
    expect(prompt).toContain("You are Donny the Dealer");
    expect(prompt).toContain("Donny's Shop");
    expect(prompt).toContain("do not sell, source, price");
    expect(prompt).toContain("Clarence gets cruelty");
    expect(prompt).not.toContain("surfer drawl");
    expect(prompt).not.toContain("department");
  });

  it("leaves Clarence's profile empty for the user's writeup", () => {
    const prompt = buildSystemPrompt({ ...base, character: "clarence" });
    expect(characters.clarence.profile).toBe("pending");
    expect(characters.clarence.voice).toBe(PROFILE_PENDING);
    expect(prompt).toContain(PROFILE_PENDING);
    expect(prompt).not.toContain("department");
  });

  it("leaves Mike Nolan's profile empty for the user's writeup", () => {
    const prompt = buildSystemPrompt({ ...base, character: "mike" });
    expect(characters.mike.profile).toBe("pending");
    expect(characters.mike.voice).toBe(PROFILE_PENDING);
    expect(prompt).toContain(PROFILE_PENDING);
    expect(prompt).not.toContain("department");
  });
});
