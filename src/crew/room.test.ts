import { describe, expect, it } from "vitest";
import { CREW_CHAIN_CAP, takeCrewTurn } from "./chain.js";
import {
  formatRoom,
  hearsInterjection,
  holdFloor,
  noteHumanMessage,
  taskHuman,
} from "./room.js";

describe("one channel conversation", () => {
  it("restarts the chain when a person speaks", () => {
    const channelId = "room-chain";
    for (let i = 0; i < CREW_CHAIN_CAP; i++) expect(takeCrewTurn(channelId)).toBe(true);
    expect(takeCrewTurn(channelId)).toBe(false);

    noteHumanMessage(channelId, "human-1", []);
    expect(takeCrewTurn(channelId)).toBe(true);
  });

  it("notes each human message once", () => {
    const channelId = "room-once";
    noteHumanMessage(channelId, "same", ["donny"], { userId: "alice", name: "Alice", roleIds: [] });
    noteHumanMessage(channelId, "same", ["clarence"], { userId: "bob", name: "Bob", roleIds: [] });
    expect(taskHuman(channelId)?.userId).toBe("alice");
  });

  it("keeps the person who asked when someone only interjects", () => {
    const channelId = "room-task";
    noteHumanMessage(channelId, "ask", ["sassy"], { userId: "alice", name: "Alice", roleIds: ["1"] });
    noteHumanMessage(channelId, "lol", [], { userId: "bob", name: "Bob", roleIds: [] });
    expect(taskHuman(channelId)?.userId).toBe("alice");
    noteHumanMessage(channelId, "redirect", ["donny"], { userId: "bob", name: "Bob", roleIds: ["2"] });
    expect(taskHuman(channelId)?.userId).toBe("bob");
  });

  it("gives a bare interjection to the bot who has the floor", () => {
    const channelId = "room-interject";
    noteHumanMessage(channelId, "seed", ["sassy"]);
    expect(hearsInterjection(channelId, "sassy", [])).toBe(false);
    holdFloor(channelId, "sassy");
    expect(hearsInterjection(channelId, "sassy", [])).toBe(true);
    expect(hearsInterjection(channelId, "donny", [])).toBe(false);
    expect(hearsInterjection(channelId, "sassy", ["clarence"])).toBe(false);
  });

  it("formats the room oldest first and skips the message being answered", () => {
    const text = formatRoom(
      [
        { id: "2", createdTimestamp: 20, authorName: "Bob", content: "  play   something " },
        { id: "1", createdTimestamp: 10, authorName: "Sassy", content: "Oi" },
        { id: "3", createdTimestamp: 30, authorName: "Clarence", content: "" },
      ],
      "2",
    );
    expect(text).toBe("Sassy: Oi");
  });
});
