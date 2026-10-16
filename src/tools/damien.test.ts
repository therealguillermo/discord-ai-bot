import { describe, expect, it } from "vitest";
import { findDamienSticker } from "./damien.js";

describe("findDamienSticker", () => {
  const stickers = [
    { id: "1", name: "other" },
    { id: "2", name: "WDamien" },
    { id: "3", name: "wdamien " },
  ];

  it("matches the wdamien sticker regardless of case or surrounding space", () => {
    expect(findDamienSticker(stickers)?.id).toBe("2");
  });

  it("returns undefined when the server has no wdamien sticker", () => {
    expect(findDamienSticker([{ id: "9", name: "damien" }])).toBeUndefined();
  });
});
