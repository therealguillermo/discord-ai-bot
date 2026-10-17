import { Events, type Client } from "discord.js";

/**
 * login() resolves on the READY payload, before guilds finish loading.
 * isReady() stays false until then, so a one-shot check skips work forever.
 */
export function whenClientReady(client: Client, timeoutMs = 20_000): Promise<Client<true>> {
  if (client.isReady()) return Promise.resolve(client);
  return new Promise((resolve, reject) => {
    const onReady = (ready: Client<true>) => {
      clearTimeout(timer);
      resolve(ready);
    };
    const timer = setTimeout(() => {
      client.off(Events.ClientReady, onReady);
      reject(new Error("Discord gateway was not ready in time."));
    }, timeoutMs);
    timer.unref();
    client.once(Events.ClientReady, onReady);
  });
}
