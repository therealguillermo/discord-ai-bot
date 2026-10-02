import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EconomyStore } from "./store.js";

let dir: string;
let file: string;
const make = (startingBalance = 100) => new EconomyStore({ filePath: file, startingBalance });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "econ-"));
  file = path.join(dir, "economy.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("accounts", () => {
  it("creates an account with the starting balance exactly once", async () => {
    const s = make(100);
    await s.load();
    expect(s.ensure("u1")).toBe(true);
    expect(s.ensure("u1")).toBe(false);
    expect(s.getBalance("u1")).toBe(100);
  });

  it("reads 0 for unknown users without creating them", async () => {
    const s = make();
    await s.load();
    expect(s.getBalance("nobody")).toBe(0);
    expect(s.has("nobody")).toBe(false);
  });
});

describe("credit / debit", () => {
  it("never lets a balance go negative", async () => {
    const s = make(50);
    await s.load();
    s.ensure("u1");
    expect(s.debit("u1", 51)).toBe(false);
    expect(s.getBalance("u1")).toBe(50);
    expect(s.debit("u1", 50)).toBe(true);
    expect(s.getBalance("u1")).toBe(0);
  });

  it("rejects negative, fractional and non-finite amounts", async () => {
    const s = make(50);
    await s.load();
    s.ensure("u1");
    for (const bad of [-5, 0, 1.5, NaN, Infinity]) {
      expect(() => s.credit("u1", bad)).toThrow();
      expect(() => s.debit("u1", bad)).toThrow();
      expect(() => s.hold("u1", bad)).toThrow();
    }
    expect(s.getBalance("u1")).toBe(50);
  });
});

describe("escrow", () => {
  it("moves the bet out of the balance on hold and pays out on settle", async () => {
    const s = make(100);
    await s.load();
    s.ensure("u1");
    const id = s.hold("u1", 40)!;
    expect(s.getBalance("u1")).toBe(60);
    const r = s.settle(id, 80);
    expect(r).toEqual({ net: 40, balance: 140 });
  });

  it("refuses to hold more than the balance", async () => {
    const s = make(100);
    await s.load();
    s.ensure("u1");
    expect(s.hold("u1", 101)).toBeNull();
    expect(s.getBalance("u1")).toBe(100);
  });

  it("can only be settled once (no double payouts)", async () => {
    const s = make(100);
    await s.load();
    s.ensure("u1");
    const id = s.hold("u1", 10)!;
    s.settle(id, 20);
    expect(() => s.settle(id, 20)).toThrow();
    expect(s.getBalance("u1")).toBe(110);
  });

  it("supports doubling down by adding to the hold", async () => {
    const s = make(100);
    await s.load();
    s.ensure("u1");
    const id = s.hold("u1", 30)!;
    expect(s.addToHold(id, 30)).toBe(true);
    expect(s.getBalance("u1")).toBe(40);
    expect(s.settle(id, 120)).toEqual({ net: 60, balance: 160 });
  });

  it("refuses a double down the player can't afford", async () => {
    const s = make(100);
    await s.load();
    s.ensure("u1");
    const id = s.hold("u1", 80)!;
    expect(s.addToHold(id, 80)).toBe(false);
    expect(s.getBalance("u1")).toBe(20);
  });

  it("refunds bets left in escrow by a crash on the next load", async () => {
    const a = make(100);
    await a.load();
    a.ensure("u1");
    a.hold("u1", 60); // process "dies" here
    await a.flush();

    const b = make(100);
    const { refunded } = await b.load();
    expect(refunded).toBe(1);
    expect(b.getBalance("u1")).toBe(100);
    // and it stays refunded
    const c = make(100);
    expect((await c.load()).refunded).toBe(0);
    expect(c.getBalance("u1")).toBe(100);
  });
});

describe("legacy import", () => {
  it("lets a user claim an old balance once, by name", async () => {
    const s = make(0);
    await s.load();
    s.importLegacy({ alice: 250.9, bob: 10 });
    s.ensure("u1");
    expect(s.claimLegacy("u1", ["alice"])).toBe(250);
    expect(s.getBalance("u1")).toBe(250);
    expect(s.claimLegacy("u1", ["alice"])).toBe(0); // already claimed
    expect(s.getBalance("u1")).toBe(250);
  });

  it("ignores negative or junk legacy values", async () => {
    const s = make(0);
    await s.load();
    s.importLegacy({ neg: -500, junk: "abc" as unknown as number });
    s.ensure("u1");
    expect(s.claimLegacy("u1", ["neg", "junk"])).toBe(0);
    expect(s.getBalance("u1")).toBe(0);
  });

  it("does not overwrite existing legacy entries on re-import", async () => {
    const s = make(0);
    await s.load();
    expect(s.importLegacy({ alice: 100 })).toBe(1);
    expect(s.importLegacy({ alice: 999 })).toBe(0);
    s.ensure("u1");
    expect(s.claimLegacy("u1", ["alice"])).toBe(100);
  });
});

describe("persistence", () => {
  it("round-trips through disk", async () => {
    const a = make(100);
    await a.load();
    a.ensure("u1");
    a.credit("u1", 5);
    await a.flush();

    const b = make(100);
    await b.load();
    expect(b.getBalance("u1")).toBe(105);
  });

  it("leaves no temp file behind and writes valid JSON", async () => {
    const s = make(100);
    await s.load();
    s.ensure("u1");
    await s.flush();
    JSON.parse(await readFile(file, "utf8"));
    await expect(readFile(`${file}.tmp`, "utf8")).rejects.toThrow();
  });

  it("refuses to start from a corrupt file instead of silently wiping the economy", async () => {
    await writeFile(file, "{ not json", "utf8");
    await expect(make().load()).rejects.toThrow(/not valid JSON/);
  });

  it("sorts the leaderboard by balance", async () => {
    const s = make(0);
    await s.load();
    s.ensure("a");
    s.ensure("b");
    s.ensure("c");
    s.credit("a", 5);
    s.credit("b", 50);
    s.credit("c", 20);
    expect(s.leaderboard(2).map((r) => r.userId)).toEqual(["b", "c"]);
  });
});
