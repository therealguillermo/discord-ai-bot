import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { failureText, MISSING_REPLY } from "./failure.js";

describe("failureText", () => {
  it("keeps Sassy's wording and a plain line for the other bots", () => {
    const err = new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", undefined as never);
    expect(failureText(err, "sassy")).toContain("ANTHROPIC_API_KEY");
    expect(failureText(err, "sassy")).toContain("mate");
    expect(failureText(err)).not.toContain("mate");
  });

  it("names a rate limit and a missing model", () => {
    expect(failureText(new Anthropic.RateLimitError(429, undefined, "slow down", undefined as never), "plain")).toContain(
      "rate limit",
    );
    expect(failureText(new Anthropic.NotFoundError(404, undefined, "missing", undefined as never))).toContain(
      "ANTHROPIC_MODEL",
    );
  });

  it("includes the error and stays short", () => {
    const text = failureText(new Error(`boom ${"x".repeat(800)}`));
    expect(text.startsWith("Something went wrong before I could answer: boom")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(failureText("")).toContain("unknown error");
  });

  it("always has something to post", () => {
    expect(failureText(new Error("  ")).trim().length).toBeGreaterThan(0);
    expect(MISSING_REPLY.trim().length).toBeGreaterThan(0);
  });
});
