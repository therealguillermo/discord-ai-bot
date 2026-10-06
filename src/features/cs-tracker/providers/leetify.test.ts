import { describe, expect, it } from "vitest";
import {
  fetchLeetifyProfile,
  leetifyMatchBySourcePath,
  leetifyMatchPath,
  leetifyMatchesPath,
  leetifyProfilePath,
  mapLeetifyProfile,
  type LeetifyClient,
} from "./leetify.js";

const profile = {
  privacy_mode: "public",
  winrate: 0.6429,
  total_matches: 2361,
  name: "Slinky",
  steam64_id: "76561197969209908",
  id: "e50a982e-d8ec-4627-996f-017ed9d7162e",
  ranks: {
    leetify: 2.12,
    premier: 19309,
    faceit: 9,
    faceit_elo: null,
    wingman: 17,
    renown: 16482,
    competitive: [
      { map_name: "de_nuke", rank: 14 },
      { map_name: "de_mills", rank: 0 },
    ],
  },
  rating: {
    aim: 60.2568,
    positioning: 57.1424,
    utility: 70.1944,
    clutch: 0.0938,
    opening: -0.0024,
    ct_leetify: 0.0176,
    t_leetify: 0.0248,
  },
};

describe("leetify paths", () => {
  it("builds the four public routes", () => {
    expect(leetifyProfilePath({ steam64Id: "76561197969209908" })).toBe(
      "/v3/profile?steam64_id=76561197969209908",
    );
    expect(leetifyMatchesPath({ leetifyId: "e50a982e-d8ec-4627-996f-017ed9d7162e" })).toBe(
      "/v3/profile/matches?id=e50a982e-d8ec-4627-996f-017ed9d7162e",
    );
    expect(leetifyMatchPath("f78ae802-9044-4aa1-be47-d8e0193c4bd7")).toBe(
      "/v2/matches/f78ae802-9044-4aa1-be47-d8e0193c4bd7",
    );
    expect(leetifyMatchBySourcePath("faceit", "1-abc")).toBe("/v2/matches/faceit/1-abc");
  });

  it("rejects a data source that is not one path segment", () => {
    expect(() => leetifyMatchBySourcePath("faceit/extra", "1")).toThrow(/data_source/);
  });
});

describe("mapLeetifyProfile", () => {
  it("keeps API numbers as returned", () => {
    const partial = mapLeetifyProfile(profile, "76561197969209908");
    expect(partial.leetify?.rating).toBe(2.12);
    expect(partial.cs2?.premierRating).toBe(19309);
    expect(partial.faceit?.level).toBe(9);
    expect(partial.faceit?.elo).toBeUndefined();
    expect(partial.leetify?.ranks).toEqual({
      leetify: 2.12,
      premier: 19309,
      faceit: 9,
      wingman: 17,
      renown: 16482,
      competitive: profile.ranks.competitive,
    });
    expect(partial.leetify?.url).toBe("https://leetify.com/app/profile/76561197969209908");
    expect(partial.raw).toMatchObject({ winrate: 0.6429, rating: { aim: 60.2568 } });
  });
});

describe("fetchLeetifyProfile", () => {
  it("skips when Leetify is disabled", async () => {
    const partial = await fetchLeetifyProfile("76561197969209908", null);
    expect(partial).toEqual({ provider: "leetify", status: "skipped" });
  });

  it("records an API error without throwing", async () => {
    const client = {
      getProfile: async () => {
        throw new Error("Leetify 404");
      },
    } as unknown as LeetifyClient;
    const partial = await fetchLeetifyProfile("76561197969209908", client);
    expect(partial.status).toBe("error");
    expect(partial.error).toBe("Leetify 404");
  });
});
