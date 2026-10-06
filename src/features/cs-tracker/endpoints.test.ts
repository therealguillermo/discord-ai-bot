import { describe, expect, it } from "vitest";
import { isCloudflareChallenge } from "./http.js";
import { csrepMatchPath, csrepResult, mapCsrepPlayer } from "./providers/csrep.js";
import { linksFromHtml } from "./providers/csst.js";
import { cstrackerFaceit, cstrackerSectionUrls, cstrackerTrust } from "./providers/cstracker.js";

describe("csrepResult", () => {
  it("unwraps the status/result envelope and surfaces ERROR", () => {
    expect(csrepResult({ status: "OK", result: { id: "1" } })).toEqual({ ok: true, result: { id: "1" } });
    expect(csrepResult({ status: "ERROR", message: "nope" })).toEqual({ ok: false, error: "nope" });
    expect(csrepResult([{ id: "76561198000000000" }]).ok).toBe(true);
  });
});

describe("mapCsrepPlayer", () => {
  it("reads the published player fields", () => {
    const partial = mapCsrepPlayer({
      id: "76561198160182330",
      name: "Dubbus",
      avatar: "https://example.com/a.png",
      cs2_hours: 1200,
      faceit_url: "https://www.faceit.com/en/players/dubbus",
      reputation: { trust_score: 72 },
      ranks: { premier: { current: 18000, peak: 19000 } },
      bans: [{ type: "VAC" }, { type: "GAME" }],
      refreshed_at: "2026-01-01T00:00:00.000Z",
    });
    expect(partial.identity?.personaName).toBe("Dubbus");
    expect(partial.cs2?.hours).toBe(1200);
    expect(partial.cs2?.premierRating).toBe(18000);
    expect(partial.faceit?.nickname).toBe("dubbus");
    expect(partial.faceit?.url).toContain("faceit.com");
    expect(partial.trust?.score).toBe(72);
    expect(partial.bans).toMatchObject({ vac: true, gameBan: true, community: false, numberOfBans: 2 });
    expect(partial.links?.csrep).toContain("76561198160182330");
  });
});

describe("csrepMatchPath", () => {
  it("builds the three match routes", () => {
    expect(csrepMatchPath("csrep", "abc")).toBe("/matches/abc");
    expect(csrepMatchPath("faceit", "1/2")).toBe("/matches/faceit/1%2F2");
    expect(csrepMatchPath("gamersclub", "gc1")).toBe("/matches/gamersclub/gc1");
  });
});

describe("linksFromHtml", () => {
  it("keeps known profile hosts from the links fragment", () => {
    const html = `
      <a href="https://www.faceit.com/en/players/dubbus">f</a>
      <a href="https://leetify.com/app/profile/1">l</a>
      <a href="https://example.com/nope">n</a>
    `;
    expect(linksFromHtml(html)).toEqual({
      faceit: "https://www.faceit.com/en/players/dubbus",
      leetify: "https://leetify.com/app/profile/1",
    });
  });
});

describe("cstracker header stats", () => {
  it("reads the FACEIT tooltip and the trust strip", () => {
    const html = `
      <span title="FACEIT level 8 · 1,726 ELO"><span>1,726</span></span>
      <p>trust rating 89.9 %</p>
    `;
    expect(cstrackerFaceit(html)).toEqual({ level: 8, elo: 1726 });
    expect(cstrackerTrust(html)).toBe(89.9);
  });
});

describe("isCloudflareChallenge", () => {
  it("recognizes the interstitial and ignores a normal 403", () => {
    expect(isCloudflareChallenge(403, "<title>Just a moment...</title>")).toBe(true);
    expect(isCloudflareChallenge(403, "nope")).toBe(false);
    expect(isCloudflareChallenge(200, "Just a moment")).toBe(false);
  });
});

describe("cstrackerSectionUrls", () => {
  it("keeps same-origin hx-get targets and drops other hosts and later pages", () => {
    const html = `
      <div hx-get="sections/chat?page=1"></div>
      <div hx-get="/players/76561198160182330/sections/stats"></div>
      <div hx-get="sections/chat?page=2"></div>
      <div hx-get="https://evil.example/steal"></div>
      <div hx-get="sections/chat?page=1"></div>
    `;
    expect(cstrackerSectionUrls(html, "https://cstracker.gg/players/76561198160182330")).toEqual([
      "https://cstracker.gg/players/sections/chat?page=1",
      "https://cstracker.gg/players/76561198160182330/sections/stats",
    ]);
  });
});
