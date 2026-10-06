import { describe, expect, it } from "vitest";
import { applyFaceitHistory, csstRejectReason, faceitHistoryPaths, parseCsstProfile } from "./providers/csstParse.js";

const steam = `
<p class="text-white text-xl font-semibold whitespace-normal">
  <a href="https://steamcommunity.com/id/dubbus/">Gearm0 =P</a>
</p>
<p class="text-white friendPlayerLevel">575</p>
<p class="text-xs uppercase">CS Friendcode </p><p class="text-white">SSL8L-Z7CN</p>
<p class="text-xs uppercase">Registered </p>
<p class="text-white"><span class="tooltip" data-tip="22:18:51 Oct 24, 2014">
  <time datetime="2014-10-24T22:18:51+00:00">Oct 24, 2014</time>
</span></p>
<p class="text-xs uppercase">Vanity</p><p class="text-white">dubbus</p>
<p class="text-xs uppercase">Friends </p><p class="text-white">387</p>
<p class="text-xs uppercase">Country </p>
<div class="tooltip" data-tip="US"><img alt="US" src="https://flagsapi.com/US/flat/64.png" /></div>
<p class="text-xs uppercase">CS2 Playtime </p>
<p class="text-white">
  <span class="tooltip" data-tip="Total">494h</span> / <span class="tooltip" data-tip="Last 2 weeks">48h</span>
</p>
<img src="https://avatars.steamstatic.com/abc_full.jpg" />
`;

const faceit = `
<p class="text-white text-xl font-semibold">
  <a href="https://www.faceit.com/en/players/MyNameIsH">MyNameIsH</a>
</p>
<p class="text-xs uppercase">Registered </p>
<p><time datetime="2016-08-31T19:47:27.794+00:00">Aug 31, 2016</time></p>
<p class="text-xs uppercase">Country </p>
<p><img alt="US" src="https://flagsapi.com/US/flat/64.png" /> / <span class="text-white">en</span></p>
<input type="radio" aria-label="csgo" />
<div role="tabpanel">
  <p class="text-xs uppercase">ELO </p>
  <p class="text-white">1726 <img alt="Faceit level 8" src="/assets/images/faceit_levels/8.svg" /></p>
  <div hx-get="/0f528a7f-34be-42f4-8810-962fd970efea/faceit-history?game_id=csgo">
    <p class="text-xs uppercase">Peak ELO </p>
    <p class="loading loading-spinner"></p>
  </div>
</div>
<input type="radio" aria-label="cs2" checked />
<div role="tabpanel">
  <p class="text-xs uppercase">ELO </p>
  <p class="text-white">1726 <img alt="Faceit level 8" src="/assets/images/faceit_levels/8.svg" /></p>
  <p class="text-xs uppercase">Winrate </p><p class="text-white">57.02%</p>
  <p class="text-xs uppercase">Matches </p><p class="text-white">349</p>
</div>
`;

const leetify = `
<a id="leetify-name" href="https://leetify.com/app/profile/76561198160182330" class="text-white text-xl font-semibold">Gearm0 =P</a>
<p class="text-xs uppercase">Aim</p><p>95.2</p>
<p class="text-xs uppercase">Preaim</p>
<p class="text-red-500 tooltip" data-tip="This is lower than the preaim angle of all T1 pros, which is extremely suspicious.">0.30°</p>
<p class="text-xs uppercase">Rating</p>
<span class="tooltip" data-tip="CT: +6.6 / T: +6.6">+6.6</span>
<p class="text-xs uppercase">KD</p><span class="loading loading-spinner"></span>
<div class="rank-leetify">
  <img alt="Premier" />
  <div class="cs2rating common">?</div>
  <img alt="de_dust2" title="de_dust2" />
  <img src="/assets/images/skillgroups/skillgroup16.svg" alt="Matchmaking rank" />
</div>
`;

const leetifyExtra = `
<p class="text-xs uppercase">KD</p><p>1.65</p>
<p class="text-xs uppercase">Preaim</p><p>7.90°</p>
<span data-tip="CT: +6.6 / T: +6.6">+6.6</span>
`;

const gc = `
<img title="Ten Year Service Coin" alt="Ten Year Service Coin" />
<img title="prestige coin 2026 level 2" alt="prestige coin 2026 level 2" />
<p class="text-xs uppercase">XP level </p><span>1932</span>
<p class="text-xs uppercase">Commendations </p>
<p>
  <div class="tooltip" data-tip="Friendy"><span>39</span><img alt="friendly" /></div>
  <div class="tooltip" data-tip="Leader"><span>36</span></div>
  <div class="tooltip" data-tip="Teacher"><span>38</span></div>
</p>
`;

const tracker = `
<section class="cstracker-card">
  <p class="cstracker-trust-value text-green-400">89.9<span class="cstracker-trust-unit">%</span></p>
  <p class="cstracker-label">TTD</p><p>534 ms</p>
  <ul>
    <li><span>Consistent performance across recent matches</span><span class="text-green-400">+5.2%</span></li>
  </ul>
  <table><thead><tr><th>Map</th><th>Score</th><th>Link</th></tr></thead>
  <tbody><tr>
    <td><span>Mirage</span></td>
    <td><span class="text-green-400">13:7</span></td>
    <td><a href="https://cstracker.gg/matches/42">Link</a></td>
  </tr></tbody></table>
</section>
`;

const inventory = `
<p class="text-xs uppercase">Inventory value </p><p class="text-white">4,220.35$</p>
<h3><span>CS2 Inventory</span> 4,220.35$</h3>
<a href="https://steamcommunity.com/market/listings/730/AWP%20%7C%20Asiimov">
  <p class="text-white font-semibold">746.06$</p>
  <p class="text-sm text-white truncate" title="AWP | Asiimov">AWP | Asiimov</p>
  <p class="text-xs text-neutral-500"><span>Field-Tested</span></p>
</a>
`;

describe("parseCsstProfile", () => {
  const faceitWithPeak = applyFaceitHistory(
    faceit,
    "cs2",
    `<div><p class="text-xs uppercase">Peak ELO </p><p class="text-white">1800</p></div>`,
  );
  const profile = parseCsstProfile("76561198160182330", {
    steam,
    faceit: faceitWithPeak,
    leetify,
    "leetify-extra": leetifyExtra,
    "game-coordinator": gc,
    cstracker: tracker,
    inventory,
  });

  it("keeps steam labels, the exact registration time, and playtime parts", () => {
    expect(profile.steam?.name).toBe("Gearm0 =P");
    expect(profile.steam?.url).toContain("steamcommunity.com/id/dubbus");
    expect(profile.steam?.level).toBe("575");
    expect(profile.steam?.avatarUrl).toContain("avatars.steamstatic.com");
    expect(profile.steam?.fields["CS Friendcode"]).toBe("SSL8L-Z7CN");
    expect(profile.steam?.fields.Registered).toBe("2014-10-24T22:18:51+00:00");
    expect(profile.steam?.fields.Vanity).toBe("dubbus");
    expect(profile.steam?.fields.Friends).toBe("387");
    expect(profile.steam?.fields.Country).toBe("US");
    expect(profile.steam?.fields["CS2 Playtime"]).toBe("Total: 494h / Last 2 weeks: 48h");
    expect(profile.steam?.fields["XP level"]).toBe("1932");
    expect(profile.steam?.fields.Commendations).toContain("Friendy: 39");
    expect(profile.steam?.fields.Commendations).toContain("Teacher: 38");
    expect(profile.medals).toEqual(["Ten Year Service Coin", "prestige coin 2026 level 2"]);
  });

  it("does not mix FACEIT csgo and cs2, and keeps the later peak elo", () => {
    expect(profile.faceit?.name).toBe("MyNameIsH");
    expect(profile.faceit?.games.csgo?.fields.ELO).toBe("1726");
    expect(profile.faceit?.games.csgo?.fields.Level).toBe("8");
    expect(profile.faceit?.games.csgo?.fields["Peak ELO"]).toBeUndefined();
    expect(profile.faceit?.games.cs2?.fields.Winrate).toBe("57.02%");
    expect(profile.faceit?.games.cs2?.fields.Matches).toBe("349");
    expect(profile.faceit?.games.cs2?.fields["Peak ELO"]).toBe("1800");
    expect(profile.faceit?.fields.Registered).toBe("2016-08-31T19:47:27.794+00:00");
    expect(profile.faceit?.fields.Country).toBe("US / en");
  });

  it("lets leetify-extra replace spinners and keeps the suspicion note", () => {
    expect(profile.leetify?.fields.KD).toBe("1.65");
    expect(profile.leetify?.fields.Preaim).toBe("7.90°");
    expect(profile.leetify?.fields.Aim).toBe("95.2");
    expect(profile.leetify?.fields.Rating).toBe("+6.6");
    expect(profile.leetify?.notes?.Rating).toBe("CT: +6.6 / T: +6.6");
    expect(profile.leetify?.notes?.Preaim).toBeUndefined();
    expect(profile.leetify?.ranks).toEqual([
      { mode: "Premier", rank: "?" },
      { mode: "de_dust2", rank: "16" },
    ]);
  });

  it("reads cstracker trust, factors, and match rows", () => {
    expect(profile.cstracker?.trust).toBe("89.9%");
    expect(profile.cstracker?.factors?.[0]).toEqual({
      label: "Consistent performance across recent matches",
      delta: "+5.2%",
    });
    expect(profile.cstracker?.matches?.[0]).toMatchObject({
      Map: "Mirage",
      Score: "13:7",
      Link: "https://cstracker.gg/matches/42",
    });
  });

  it("reads inventory name, price, and wear", () => {
    expect(profile.inventory?.value).toBe("4,220.35$");
    expect(profile.inventory?.items?.[0]).toMatchObject({
      name: "AWP | Asiimov",
      price: "746.06$",
      wear: "Field-Tested",
    });
  });
});

describe("csstRejectReason", () => {
  it("drops placeholder pages that stamp one clock onto different dates", () => {
    const html = `
      <time datetime="2018-09-12T20:45:31+00:00"></time>
      <time datetime="2017-07-10T20:45:31+00:00"></time>
    `;
    expect(csstRejectReason(html)).toMatch(/placeholder/);
  });

  it("keeps a real profile whose events happened at different times", () => {
    const html = `
      <time datetime="2014-10-24T22:18:51+00:00"></time>
      <time datetime="2016-08-31T19:47:27.794+00:00"></time>
    `;
    expect(csstRejectReason(html)).toBeUndefined();
  });

  it("drops a Cloudflare interstitial", () => {
    expect(csstRejectReason("Performing security verification")).toMatch(/Cloudflare/);
  });
});

describe("faceitHistoryPaths", () => {
  it("keeps same-origin history fragments only", () => {
    expect(faceitHistoryPaths(faceit)).toEqual([
      "/0f528a7f-34be-42f4-8810-962fd970efea/faceit-history?game_id=csgo",
    ]);
  });
});
