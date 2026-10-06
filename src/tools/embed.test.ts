import { describe, expect, it } from "vitest";
import { UserError } from "../features/types.js";
import { buildReplyEmbeds } from "./embed.js";

describe("buildReplyEmbeds", () => {
  it("builds one embed from top-level fields, images, and a hex color", () => {
    const built = buildReplyEmbeds({
      content: "Slinky",
      title: "Slinky",
      url: "https://leetify.com/app/profile/76561197969209908",
      description: "Premier **19309**",
      color: "#F84982",
      thumbnail_url: "https://example.com/avatar.png",
      image: { url: "https://example.com/banner.png" },
      author: "Data Provided by Leetify",
      footer: { text: "View on Leetify", icon_url: "https://example.com/icon.png" },
      fields: [
        { name: "Aim", value: 60.2568, inline: true },
        { name: "Winrate", value: "0.6429", inline: "true" },
      ],
    });

    expect(built.content).toBe("Slinky");
    expect(built.embeds).toHaveLength(1);
    expect(built.embeds[0]).toMatchObject({
      title: "Slinky",
      url: "https://leetify.com/app/profile/76561197969209908",
      color: 0xf84982,
      thumbnail: { url: "https://example.com/avatar.png" },
      image: { url: "https://example.com/banner.png" },
      author: { name: "Data Provided by Leetify" },
      footer: { text: "View on Leetify", icon_url: "https://example.com/icon.png" },
      fields: [
        { name: "Aim", value: "60.2568", inline: true },
        { name: "Winrate", value: "0.6429", inline: true },
      ],
    });
  });

  it("accepts an embeds array", () => {
    const built = buildReplyEmbeds({
      embeds: [{ title: "One", description: "A" }, { description: "B", image_url: "https://example.com/b.png" }],
    });
    expect(built.embeds).toHaveLength(2);
    expect(built.embeds[1]?.image?.url).toBe("https://example.com/b.png");
  });

  it("rejects a non-http image and a title that is too long", () => {
    expect(() => buildReplyEmbeds({ title: "x", image_url: "javascript:alert(1)" })).toThrow(UserError);
    expect(() => buildReplyEmbeds({ title: "x".repeat(257) })).toThrow(/256/);
  });

  it("rejects mixing a top-level embed with an embeds array", () => {
    expect(() => buildReplyEmbeds({ title: "A", embeds: [{ title: "B" }] })).toThrow(/not both/);
  });
});
