import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../types.js";
import { LinkStore } from "./links.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function tempStore(): Promise<LinkStore> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cs-links-"));
  dirs.push(dir);
  const store = new LinkStore({ filePath: path.join(dir, "cs-links.json") });
  await store.load();
  return store;
}

describe("LinkStore", () => {
  it("links many steams to one discord user with primary", async () => {
    const s = await tempStore();
    s.link("111", "76561198160182330", { label: "main" });
    s.link("111", "76561198000000000", { label: "smurf" });
    const list = s.list("111");
    expect(list).toHaveLength(2);
    expect(list.filter((a) => a.primary)).toHaveLength(1);
    expect(list[0]!.primary).toBe(true);
  });

  it("enforces steam uniqueness across discord users", async () => {
    const s = await tempStore();
    s.link("111", "76561198160182330");
    expect(() => s.link("222", "76561198160182330")).toThrow(UserError);
  });

  it("setPrimary and unlink", async () => {
    const s = await tempStore();
    s.link("111", "76561198160182330", { label: "a" });
    s.link("111", "76561198000000000", { label: "b" });
    s.setPrimary("111", "b");
    expect(s.primary("111")?.steamId64).toBe("76561198000000000");
    s.unlink("111", "b");
    expect(s.list("111")).toHaveLength(1);
    expect(s.primary("111")?.primary).toBe(true);
  });

  it("persists to disk", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cs-links-"));
    dirs.push(dir);
    const file = path.join(dir, "cs-links.json");
    const s1 = new LinkStore({ filePath: file });
    await s1.load();
    s1.link("111", "76561198160182330", { label: "main" });
    await s1.flush();

    const s2 = new LinkStore({ filePath: file });
    await s2.load();
    expect(s2.list("111")[0]?.steamId64).toBe("76561198160182330");
  });
});
