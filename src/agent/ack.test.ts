import { describe, expect, it } from "vitest";
import { acknowledgement, isSlowRequest } from "./ack.js";

describe("isSlowRequest", () => {
  it("catches music, lookups, and pictures", () => {
    expect(isSlowRequest("can you play me me likey by trippie red")).toBe(true);
    expect(isSlowRequest("Oi, sort this: play https://www.youtube.com/watch?v=mSQnhKKmC1s")).toBe(true);
    expect(isSlowRequest("what's his leetify")).toBe(true);
    expect(isSlowRequest("draw a sasquatch")).toBe(true);
  });

  it("leaves banter, queue checks, and fast games alone", () => {
    expect(isSlowRequest("g'day mate")).toBe(false);
    expect(isSlowRequest("what's playing")).toBe(false);
    expect(isSlowRequest("skip")).toBe(false);
    expect(isSlowRequest("play blackjack for 50")).toBe(false);
  });
});

describe("acknowledgement", () => {
  it("uses Clarence's voice and stays the same for the same line", () => {
    const text = "can you play me me likey by trippie red";
    const line = acknowledgement("clarence", text);
    expect(line).toMatch(/^(Um, coming right up\.|Oh, ok\. On it\.|Right, um, one sec\.)$/);
    expect(acknowledgement("clarence", text)).toBe(line);
  });

  it("stays quiet when the job is quick", () => {
    expect(acknowledgement("sassy", "g'day")).toBeNull();
  });
});
