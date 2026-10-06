import { describe, expect, it } from "vitest";
import { mergePartials } from "./merge.js";
import type { ProviderPartial } from "./dossier.js";

describe("mergePartials", () => {
  it("prefers csrep then fills gaps from later providers", () => {
    const partials: ProviderPartial[] = [
      {
        provider: "csrep",
        status: "ok",
        identity: { personaName: "FromCsrep" },
        cs2: { premierRating: 20000 },
        trust: { score: 80 },
      },
      {
        provider: "steam",
        status: "ok",
        identity: { personaName: "FromSteam", avatarUrl: "https://example.com/a.png" },
        bans: { vac: false },
      },
      {
        provider: "csst",
        status: "ok",
        faceit: { level: 8, elo: 2100 },
        leetify: { rating: 1.2 },
      },
      {
        provider: "cstracker",
        status: "error",
        error: "blocked",
      },
      {
        provider: "faceit",
        status: "skipped",
      },
    ];

    const d = mergePartials("76561198160182330", partials);
    expect(d.identity.personaName).toBe("FromCsrep");
    expect(d.identity.avatarUrl).toBe("https://example.com/a.png");
    expect(d.cs2.premierRating).toBe(20000);
    expect(d.faceit.level).toBe(8);
    expect(d.leetify.rating).toBe(1.2);
    expect(d.trust.score).toBe(80);
    expect(d.bans.vac).toBe(false);
    expect(d.sources.csrep).toBe("ok");
    expect(d.sources.cstracker).toBe("error");
    expect(d.sources.faceit).toBe("skipped");
    expect(d.provenance["identity.personaName"]).toBe("csrep");
    expect(d.provenance["identity.avatarUrl"]).toBe("steam");
    expect(d.errors).toContain("blocked");
    expect(d.links.csrep).toContain("76561198160182330");
    expect(d.sources.leetify).toBe("skipped");
  });

  it("keeps the official Leetify rating ahead of the CSST card", () => {
    const d = mergePartials("76561197969209908", [
      {
        provider: "leetify",
        status: "ok",
        leetify: { rating: 2.12, url: "https://leetify.com/app/profile/76561197969209908" },
        cs2: { premierRating: 19309 },
      },
      {
        provider: "csst",
        status: "ok",
        leetify: { rating: 1.2 },
        cs2: { premierRating: 15000 },
      },
    ]);
    expect(d.leetify.rating).toBe(2.12);
    expect(d.cs2.premierRating).toBe(19309);
    expect(d.provenance["leetify.rating"]).toBe("leetify");
    expect(d.sources.leetify).toBe("ok");
  });
});
