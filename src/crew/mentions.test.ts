import { describe, expect, it } from "vitest";
import { inlineCrewMentions } from "./mentions.js";

const crew = [
  { name: "Sassy the Sasquatch", mention: "<@111111111111111111>" },
  { name: "Clarence", mention: "<@222222222222222222>" },
  { name: "Donny the Dealer", mention: "<@333333333333333333>" },
  { name: "Mike Nolan", mention: "<@444444444444444444>" },
];

const sassy = "<@111111111111111111>";
const clarence = "<@222222222222222222>";
const donny = "<@333333333333333333>";
const mike = "<@444444444444444444>";

describe("inlineCrewMentions", () => {
  it("puts the mention where the name was and drops the copy on the end", () => {
    const text =
      "G'day Sassy. Um, hi. I'll try with the no sorries, mate. I'm just glad you came over to say hi. Is it alright if I say that? <@111111111111111111>";
    const next = inlineCrewMentions(text, crew);
    expect(next.startsWith(`G'day ${sassy}.`)).toBe(true);
    expect(next.endsWith(sassy)).toBe(false);
    expect(next.match(new RegExp(sassy, "g"))).toHaveLength(1);
  });

  it("replaces Nolzy with Mike's mention", () => {
    const text = "Nolzy, your turn, take this soft cunt off my hands. <@444444444444444444>";
    expect(inlineCrewMentions(text, crew)).toBe(`${mike}, your turn, take this soft cunt off my hands.`);
  });

  it("replaces every other bot named in the line", () => {
    const text =
      "Oh. Um, thanks, Sassy. Five whole seconds from Donny would be the best day I've had, honestly. <@333333333333333333>";
    expect(inlineCrewMentions(text, crew)).toBe(
      `Oh. Um, thanks, ${sassy}. Five whole seconds from ${donny} would be the best day I've had, honestly.`,
    );
  });

  it("folds a name that is already the trailing ping", () => {
    const text = "Five seconds, Clarence, and you spent two of 'em grovellin'. <@222222222222222222>";
    expect(inlineCrewMentions(text, crew)).toBe(`Five seconds, ${clarence}, and you spent two of 'em grovellin'.`);
  });

  it("leaves the speaker's own name alone when they are not in the crew list", () => {
    const others = crew.filter((member) => member.name !== "Sassy the Sasquatch");
    const text = "Oi, Sassy here. G'day Clarence.";
    expect(inlineCrewMentions(text, others)).toBe(`Oi, Sassy here. G'day ${clarence}.`);
  });

  it("leaves a mention that is already in the sentence", () => {
    const text = `Oi ${clarence}, g'day mate.`;
    expect(inlineCrewMentions(text, crew)).toBe(text);
  });

  it("turns a spoken name into the mention even when nothing was pasted on the end", () => {
    const text = "Keep that up and Donny might ease off for a whole five seconds.";
    expect(inlineCrewMentions(text, crew)).toBe(`Keep that up and ${donny} might ease off for a whole five seconds.`);
  });
});
