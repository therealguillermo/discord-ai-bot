import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { whenClientReady } from "./ready.js";

function fakeClient(ready: boolean) {
  const events = new EventEmitter();
  return {
    ready,
    isReady() {
      return this.ready;
    },
    once(event: string, listener: (client: unknown) => void) {
      events.once(event, listener);
    },
    off(event: string, listener: (client: unknown) => void) {
      events.off(event, listener);
    },
    emitReady() {
      this.ready = true;
      events.emit("clientReady", this);
    },
  };
}

describe("whenClientReady", () => {
  it("returns a client that is already ready", async () => {
    const client = fakeClient(true);
    await expect(whenClientReady(client as never)).resolves.toBe(client);
  });

  it("waits until the gateway finishes loading guilds", async () => {
    const client = fakeClient(false);
    const pending = whenClientReady(client as never, 1_000);
    client.emitReady();
    await expect(pending).resolves.toBe(client);
  });

  it("fails when the gateway never becomes ready", async () => {
    const client = fakeClient(false);
    await expect(whenClientReady(client as never, 20)).rejects.toThrow(/not ready in time/);
  });
});
