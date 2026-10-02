import { describe, expect, it } from "vitest";
import { isSteamId64, parseSteamInput } from "./steam-id.js";

describe("steam-id", () => {
  it("detects steamid64", () => {
    expect(isSteamId64("76561198160182330")).toBe(true);
    expect(isSteamId64("123")).toBe(false);
  });

  it("parses raw steamid64", () => {
    expect(parseSteamInput("76561198160182330")).toEqual({
      kind: "steamid64",
      value: "76561198160182330",
    });
  });

  it("parses profiles URL", () => {
    expect(parseSteamInput("https://steamcommunity.com/profiles/76561198160182330")).toEqual({
      kind: "steamid64",
      value: "76561198160182330",
    });
  });

  it("parses vanity URL and bare vanity", () => {
    expect(parseSteamInput("https://steamcommunity.com/id/dubbus")).toEqual({
      kind: "vanity",
      value: "dubbus",
    });
    expect(parseSteamInput("dubbus")).toEqual({ kind: "vanity", value: "dubbus" });
  });

  it("rejects garbage", () => {
    expect(() => parseSteamInput("")).toThrow();
    expect(() => parseSteamInput("12345")).toThrow(/SteamID64/);
  });
});
