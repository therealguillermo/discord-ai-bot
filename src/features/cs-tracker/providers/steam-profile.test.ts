import { describe, expect, it } from "vitest";
import { badgeName, buildSteamProfile, parseProfileXml, personaStatus } from "./steam-profile.js";

const xml = `
<profile>
  <privacyState>public</privacyState>
  <customURL><![CDATA[dubbus]]></customURL>
  <memberSince>October 24, 2014</memberSince>
  <location><![CDATA[United States]]></location>
  <realname><![CDATA[Gearm0]]></realname>
  <summary><![CDATA[Plays too much.<br>Still here.]]></summary>
  <isLimitedAccount>0</isLimitedAccount>
  <tradeBanState>None</tradeBanState>
  <groups>
    <group isPrimary="1">
      <groupName><![CDATA[Main Group]]></groupName>
      <groupURL>https://steamcommunity.com/groups/main</groupURL>
    </group>
  </groups>
</profile>
`;

describe("parseProfileXml", () => {
  it("reads the public community profile fields", () => {
    const parsed = parseProfileXml(xml);
    expect(parsed?.privacy).toBe("public");
    expect(parsed?.customUrl).toBe("dubbus");
    expect(parsed?.memberSince).toBe("October 24, 2014");
    expect(parsed?.location).toBe("United States");
    expect(parsed?.summary).toBe("Plays too much. Still here.");
    expect(parsed?.limitedAccount).toBe(false);
    expect(parsed?.tradeBan).toBeUndefined();
    expect(parsed?.groups).toEqual([
      { name: "Main Group", url: "https://steamcommunity.com/groups/main", primary: true },
    ]);
  });
});

describe("buildSteamProfile", () => {
  it("keeps games and the other public profile sections together", () => {
    const profile = buildSteamProfile({
      steamId64: "76561198000000000",
      gameLimit: 2,
      player: {
        personaname: "Dubbus",
        profileurl: "https://steamcommunity.com/id/dubbus",
        communityvisibilitystate: 3,
        personastate: 1,
        timecreated: 1414181931,
        gameextrainfo: "Counter-Strike 2",
        loccountrycode: "US",
      },
      ban: { VACBanned: false, NumberOfGameBans: 1, CommunityBanned: false, EconomyBan: "none" },
      badges: {
        player_level: 12,
        player_xp: 3400,
        player_xp_needed_to_level_up: 200,
        badges: [
          { badgeid: 1, level: 10, xp: 500 },
          { badgeid: 1, appid: 730, level: 4, xp: 300 },
        ],
      },
      badgesVisibility: "public",
      friends: [
        { steamid: "76561198000000001", friend_since: 1700000000 },
        { steamid: "76561198000000002", friend_since: 1600000000 },
      ],
      friendsVisibility: "public",
      friendNames: new Map([["76561198000000001", "Newer"]]),
      xml: parseProfileXml(xml),
      owned: {
        game_count: 2,
        games: [
          { appid: 730, name: "Counter-Strike 2", playtime_forever: 6000, playtime_2weeks: 60 },
          { appid: 570, name: "Dota 2", playtime_forever: 120 },
        ],
      },
      recent: [{ appid: 730, name: "Counter-Strike 2", playtime_forever: 6000, playtime_2weeks: 60 }],
    });

    expect(profile.profileVisibility).toBe("public");
    expect(profile.identity.personaName).toBe("Dubbus");
    expect(profile.identity.realName).toBe("Gearm0");
    expect(profile.identity.memberSince).toBe("October 24, 2014");
    expect(profile.presence).toMatchObject({ status: "Online", currentGame: "Counter-Strike 2" });
    expect(personaStatus(0)).toBe("Offline");
    expect(profile.bans).toMatchObject({ vac: false, numberOfGameBans: 1, communityBanned: false });
    expect(profile.level).toMatchObject({ level: 12, xp: 3400, xpToNextLevel: 200 });
    expect(profile.badges.featured.map((b) => b.name)).toEqual(["Years of Service", "Counter-Strike 2 badge"]);
    expect(profile.friends).toMatchObject({ visibility: "public", count: 2 });
    expect(profile.friends.sample[0]).toMatchObject({ personaName: "Newer" });
    expect(profile.groups.sample[0]?.name).toBe("Main Group");
    expect(profile.games.mostPlayed.map((g) => g.name)).toEqual(["Counter-Strike 2", "Dota 2"]);
    expect(profile.games.recent[0]?.name).toBe("Counter-Strike 2");
    expect(badgeName({ badgeid: 2 }, new Map())).toBe("Community badge 2");
  });

  it("marks hidden sections without dropping the public name", () => {
    const profile = buildSteamProfile({
      steamId64: "76561198000000000",
      gameLimit: 5,
      player: { personaname: "Hidden", communityvisibilitystate: 1, personastate: 0 },
      friendsVisibility: "private",
      badgesVisibility: "private",
      xml: parseProfileXml("<profile><privacyState>private</privacyState></profile>"),
      owned: {},
    });
    expect(profile.profileVisibility).toBe("private");
    expect(profile.identity.personaName).toBe("Hidden");
    expect(profile.games.visibility).toBe("private");
    expect(profile.friends.visibility).toBe("private");
    expect(profile.friends.sample).toEqual([]);
    expect(profile.groups.visibility).toBe("private");
  });
});
