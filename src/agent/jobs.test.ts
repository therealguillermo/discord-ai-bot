import { describe, expect, it } from "vitest";
import { characterTools, toolNamesFor } from "./jobs.js";

describe("job tools", () => {
  it("gives Clarence music and nobody else", () => {
    expect(toolNamesFor("clarence").has("music_play")).toBe(true);
    expect(toolNamesFor("clarence").has("music_queue")).toBe(true);
    expect(toolNamesFor("sassy").has("music_play")).toBe(false);
    expect(toolNamesFor("mike").has("music_play")).toBe(false);
    expect(toolNamesFor("donny").has("music_play")).toBe(false);
  });

  it("gives Mike Discord admin", () => {
    expect(toolNamesFor("mike").has("kick_member")).toBe(true);
    expect(toolNamesFor("mike").has("discord_call")).toBe(true);
    expect(toolNamesFor("sassy").has("discord_call")).toBe(false);
    expect(toolNamesFor("clarence").has("timeout_member")).toBe(false);
  });

  it("gives Donny Steam and CS", () => {
    expect(toolNamesFor("donny").has("steam_profile")).toBe(true);
    expect(toolNamesFor("donny").has("cs_player")).toBe(true);
    expect(toolNamesFor("sassy").has("cs_player")).toBe(false);
    expect(toolNamesFor("mike").has("steam_profile")).toBe(false);
  });

  it("gives the Oracle VM to whichever character is chosen", () => {
    expect(characterTools("sassy", "sassy").has("vm_exec")).toBe(true);
    expect(characterTools("sassy", "sassy").has("vm_tmux")).toBe(true);
    expect(characterTools("mike", "sassy").has("vm_exec")).toBe(false);
    expect(characterTools("mike", "mike").has("vm_tmux")).toBe(true);
    expect(characterTools("clarence", null).has("vm_exec")).toBe(false);
    expect(characterTools("donny", "donny").has("vm_exec")).toBe(true);
  });

  it("leaves coins, games, images, and Damien with Sassy", () => {
    expect(toolNamesFor("sassy").has("play_blackjack")).toBe(true);
    expect(toolNamesFor("sassy").has("economy_balance")).toBe(true);
    expect(toolNamesFor("sassy").has("generate_image")).toBe(true);
    expect(toolNamesFor("sassy").has("show_damien")).toBe(true);
    expect(toolNamesFor("donny").has("play_blackjack")).toBe(false);
    expect(toolNamesFor("clarence").has("show_damien")).toBe(false);
  });
});
