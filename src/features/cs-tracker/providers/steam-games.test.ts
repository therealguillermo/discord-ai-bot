import { describe, expect, it } from "vitest";
import { hoursFromMinutes, mapSteamGame, summarizeLibrary } from "./steam-games.js";

describe("hoursFromMinutes", () => {
  it("rounds to one decimal and keeps a sliver of playtime visible", () => {
    expect(hoursFromMinutes(90)).toBe(1.5);
    expect(hoursFromMinutes(1)).toBe(0.1);
    expect(hoursFromMinutes(0)).toBe(0);
    expect(hoursFromMinutes(undefined)).toBeUndefined();
  });
});

describe("summarizeLibrary", () => {
  it("ranks lifetime playtime and last-two-weeks play", () => {
    const library = summarizeLibrary({
      steamId64: "76561198000000000",
      personaName: "Dubbus",
      limit: 2,
      owned: {
        game_count: 3,
        games: [
          { appid: 730, name: "Counter-Strike 2", playtime_forever: 6000, playtime_2weeks: 120 },
          { appid: 570, name: "Dota 2", playtime_forever: 12000 },
          { appid: 10, name: "Counter-Strike", playtime_forever: 0 },
        ],
      },
      recent: [
        { appid: 730, name: "Counter-Strike 2", playtime_forever: 6000, playtime_2weeks: 120 },
        { appid: 440, name: "Team Fortress 2", playtime_forever: 300, playtime_2weeks: 40 },
      ],
    });

    expect(library.visibility).toBe("public");
    expect(library.gameCount).toBe(3);
    expect(library.mostPlayed.map((g) => g.name)).toEqual(["Dota 2", "Counter-Strike 2"]);
    expect(library.mostPlayed[0]?.hours).toBe(200);
    expect(library.recent.map((g) => g.name)).toEqual(["Counter-Strike 2", "Team Fortress 2"]);
    expect(library.recent[0]?.hoursTwoWeeks).toBe(2);
    expect(library.note).toBeUndefined();
    expect(mapSteamGame({ appid: 1 }).name).toBe("App 1");
  });

  it("treats a missing games list as a private profile", () => {
    const library = summarizeLibrary({
      steamId64: "76561198000000000",
      limit: 10,
      owned: {},
    });
    expect(library.visibility).toBe("private");
    expect(library.mostPlayed).toEqual([]);
    expect(library.note).toMatch(/private/i);
  });

  it("says when nothing was played in the last two weeks", () => {
    const library = summarizeLibrary({
      steamId64: "76561198000000000",
      limit: 5,
      owned: { game_count: 1, games: [{ appid: 730, name: "Counter-Strike 2", playtime_forever: 60 }] },
      recent: [],
    });
    expect(library.recent).toEqual([]);
    expect(library.mostPlayed).toEqual([
      { appid: 730, name: "Counter-Strike 2", hours: 1 },
    ]);
    expect(library.note).toMatch(/last two weeks/i);
  });
});
