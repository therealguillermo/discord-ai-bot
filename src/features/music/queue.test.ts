import { describe, expect, it } from "vitest";
import { MusicQueue, type Track } from "./queue.js";

function t(title: string): Track {
  return {
    id: title,
    title,
    pageUrl: `https://example.com/${title}`,
    durationSec: 60,
    requestedBy: "1",
  };
}

describe("MusicQueue", () => {
  it("enqueues and shifts in order", () => {
    const q = new MusicQueue();
    q.enqueue(t("a"));
    q.enqueue(t("b"));
    expect(q.shift()?.title).toBe("a");
    expect(q.shift()?.title).toBe("b");
    expect(q.shift()).toBeUndefined();
  });

  it("moves a track to the front", () => {
    const q = new MusicQueue();
    q.enqueue(t("a"));
    q.enqueue(t("b"));
    q.enqueue(t("c"));
    q.moveToFront(3);
    expect(q.list().map((x) => x.title)).toEqual(["c", "a", "b"]);
  });

  it("moves between positions", () => {
    const q = new MusicQueue();
    q.enqueue(t("a"));
    q.enqueue(t("b"));
    q.enqueue(t("c"));
    q.move(1, 3);
    expect(q.list().map((x) => x.title)).toEqual(["b", "c", "a"]);
  });

  it("removes by 1-based index", () => {
    const q = new MusicQueue();
    q.enqueue(t("a"));
    q.enqueue(t("b"));
    expect(q.remove(1).title).toBe("a");
    expect(q.list().map((x) => x.title)).toEqual(["b"]);
  });

  it("clears", () => {
    const q = new MusicQueue();
    q.enqueue(t("a"));
    expect(q.clear()).toBe(1);
    expect(q.length).toBe(0);
  });
});
