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
    expect(prompt).toContain("Wadiyatalkinabeet?");
    expect(prompt).toContain("what are you talking about");
    expect(prompt).toContain("That handoff is the job");
    expect(prompt).toContain("Order Clarence");
    expect(prompt).toContain("A real server request in the same message still gets done. If they also wandered off the job");
    expect(prompt).not.toContain("## The crew");
    expect(prompt).toContain("from crew bot: yes");
    expect(prompt).toContain("## One conversation");
    expect(prompt).toContain("Banter with the other bots stays.");
    expect(prompt).toContain("that name is their mention");
    expect(prompt).toContain("Do not say Sassy, Clarence, Donny, or Nolzy and then paste the mention on the end.");
    expect(prompt).toContain("Overlapping messages are normal.");
    expect(prompt).toContain("Chat like a normal person in Discord");
    expect(prompt).toContain("Never introduce yourself by your job");
    expect(prompt).toContain("A newer message does not erase a server job");
    expect(prompt).toContain("including a song already playing, stays finished");
    expect(prompt).toContain("## Sound like one person");
    expect(prompt).toContain("only passed it along");
    expect(prompt).toContain("I'm sorry I'm a soggy biscuit.");
    expect(prompt).toContain(characters.sassy.offJob);
    expect(characters.sassy.profile).toBe("locked");
  });

  it("gives Donny the shop voice and no real counter", () => {
    const prompt = buildSystemPrompt({ ...base, character: "donny" });
    expect(prompt).toContain("You are Donny the Dealer");
    expect(prompt).toContain("Donny's Shop");
    expect(prompt).toContain("do not sell, source, price");
    expect(prompt).toContain("Clarence gets cruelty");
    expect(prompt).toContain("You call him Nolzy, not Mike.");
    expect(prompt).toContain("You're fucken' jokin'.");
    expect(prompt).toContain("Do not quote their line.");
    expect(prompt).toContain("Fiddy bucks");
    expect(prompt).not.toContain("surfer drawl");
    expect(prompt).not.toContain("department");
  });

  it("gives Clarence the timid voice the user supplied", () => {
    const prompt = buildSystemPrompt({ ...base, character: "clarence" });
    expect(characters.clarence.profile).toBe("supplied");
    expect(prompt).toContain("You are timid, submissive, and desperate to belong");
    expect(prompt).toContain("nasal, strained, and wavering");
    expect(prompt).toContain("Ahow");
    expect(prompt).toContain("Hoovin' Shmoovin'");
    expect(prompt).toContain("Wanting to be liked does not change the rules");
    expect(prompt).toContain("You call Mike Nolan Nolzy.");
    expect(prompt).toContain("You do not staple a music update onto a roast.");
    expect(prompt).toContain("If you did not call a music tool on this turn");
    expect(prompt).not.toContain(PROFILE_PENDING);
    expect(prompt).not.toContain("department");
  });

  it("gives Mike Nolan the construction-worker voice the user supplied", () => {
    const prompt = buildSystemPrompt({ ...base, character: "mike" });
    expect(characters.mike.profile).toBe("supplied");
    expect(prompt).toContain("Mates call you Nolzy");
    expect(prompt).toContain(`say "I'm fuckin' Mike Nolan."`);
    expect(prompt).toContain("You do not call yourself Nolzy.");
    expect(prompt).not.toContain("Call him Nolzy, not Mike.");
    expect(prompt).toContain("broad Australian drawl");
    expect(prompt).toContain("Fuck me sideways");
    expect(prompt).toContain("I'll tell ya that much");
    expect(prompt).toContain("A roast or a handoff is one jab");
    expect(prompt).toContain("You do not explain how to hide money");
    expect(prompt).not.toContain(PROFILE_PENDING);
    expect(prompt).not.toContain("department");
    const chat = buildSystemPrompt({ ...base, character: "mike", mode: "chat" });
    expect(chat).toContain(`say "I'm fuckin' Mike Nolan."`);
    expect(chat).not.toContain("Call him Nolzy, not Mike.");
  });

  it("lets the other bots talk in character and leaves the tools with Sassy", () => {
    const prompt = buildSystemPrompt({
      ...base,
      character: "clarence",
      mode: "chat",
      crew: [
        { name: "Donny the Dealer", mention: "<@100000000000000003>" },
        { name: "Sassy the Sasquatch", mention: "<@100000000000000004>" },
      ],
    });
    expect(prompt).toContain("You are timid, submissive, and desperate to belong");
    expect(prompt).toContain("Music is yours");
    expect(prompt).toContain("You always do it");
    expect(prompt).toContain("## The crew");
    expect(prompt).toContain("## One conversation");
    expect(prompt).toContain("Banter with the other bots stays.");
    expect(prompt).toContain("Overlapping messages are normal.");
    expect(prompt).toContain("Chat like a normal person in Discord");
    expect(prompt).toContain("Never introduce yourself by your job");
    expect(prompt).toContain("## Sound like one person");
    expect(prompt).toContain("I'm sorry I'm a wet brick.");
    expect(prompt).not.toContain("discord_call");
  });
});
