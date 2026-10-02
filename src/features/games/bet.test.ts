import { describe, expect, it } from "vitest";
import { parseBet } from "./bet.js";

describe("parseBet", () => {
  it("accepts whole numbers within the balance", () => {
    expect(parseBet("50", 100)).toEqual({ ok: true, amount: 50 });
    expect(parseBet("100", 100)).toEqual({ ok: true, amount: 100 });
  });

  it("supports all and half", () => {
    expect(parseBet("all", 77)).toEqual({ ok: true, amount: 77 });
    expect(parseBet("ALL", 77)).toEqual({ ok: true, amount: 77 });
    expect(parseBet("half", 77)).toEqual({ ok: true, amount: 38 });
    expect(parseBet("half", 1)).toEqual({ ok: true, amount: 1 });
  });

  it("rejects the exploits the old bot allowed", () => {
    for (const bad of ["-50", "-1", "0", "1.5", "NaN", "nan", "Infinity", "inf", "1e3", "0x10", "50abc", " ", ""]) {
      expect(parseBet(bad, 1000).ok, `"${bad}" should be rejected`).toBe(false);
    }
  });

  it("rejects bets above the balance", () => {
    const r = parseBet("101", 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("100");
  });

  it("rejects missing input and empty wallets", () => {
    expect(parseBet(undefined, 100).ok).toBe(false);
    expect(parseBet("10", 0).ok).toBe(false);
    expect(parseBet("all", 0).ok).toBe(false);
  });
});
