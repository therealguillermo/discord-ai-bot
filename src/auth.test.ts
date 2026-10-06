import { describe, expect, it } from "vitest";
import { accessFor, discordWriteAllowed, type AccessRules } from "./auth.js";

const rules: AccessRules = {
  guildId: "111111111111111111",
  allowedChannelIds: [],
  ownerId: "222222222222222222",
  controllerUserIds: ["333333333333333333"],
  controllerRoleIds: ["444444444444444444"],
};

describe("accessFor", () => {
  it("lets any member of the server use the bot", () => {
    const access = accessFor(
      {
        guildId: rules.guildId,
        channelId: "555555555555555555",
        userId: "666666666666666666",
        roleIds: [],
      },
      rules,
    );
    expect(access.allowed).toBe(true);
    expect(access.discordControl).toBe(false);
  });

  it("rejects other servers and channels outside the allowlist", () => {
    expect(
      accessFor(
        { guildId: "999999999999999999", channelId: "555555555555555555", userId: rules.ownerId, roleIds: [] },
        rules,
      ).allowed,
    ).toBe(false);

    const limited = { ...rules, allowedChannelIds: ["555555555555555555"] };
    expect(
      accessFor(
        { guildId: rules.guildId, channelId: "777777777777777777", userId: rules.ownerId, roleIds: [] },
        limited,
      ).allowed,
    ).toBe(false);
    expect(
      accessFor(
        {
          guildId: rules.guildId,
          channelId: "888888888888888888",
          parentChannelId: "555555555555555555",
          userId: "666666666666666666",
          roleIds: [],
        },
        limited,
      ).allowed,
    ).toBe(true);
  });

  it("grants discord control only to the owner, allowed users, and allowed roles", () => {
    const base = { guildId: rules.guildId, channelId: "555555555555555555" };
    expect(accessFor({ ...base, userId: rules.ownerId, roleIds: [] }, rules).discordControl).toBe(true);
    expect(accessFor({ ...base, userId: "333333333333333333", roleIds: [] }, rules).discordControl).toBe(true);
    expect(
      accessFor({ ...base, userId: "666666666666666666", roleIds: ["444444444444444444"] }, rules).discordControl,
    ).toBe(true);
    expect(accessFor({ ...base, userId: "666666666666666666", roleIds: ["123"] }, rules).discordControl).toBe(false);
  });
});

describe("discordWriteAllowed", () => {
  it("allows reads for everyone and writes only for controllers", () => {
    expect(discordWriteAllowed("GET", false)).toBe(true);
    expect(discordWriteAllowed("get", false)).toBe(true);
    expect(discordWriteAllowed("POST", false)).toBe(false);
    expect(discordWriteAllowed("PATCH", false)).toBe(false);
    expect(discordWriteAllowed("PUT", false)).toBe(false);
    expect(discordWriteAllowed("DELETE", false)).toBe(false);
    expect(discordWriteAllowed("DELETE", true)).toBe(true);
  });
});
