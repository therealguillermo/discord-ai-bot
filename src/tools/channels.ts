import type { GuildBasedChannel, SendableChannels } from "discord.js";
import type { ToolContext } from "./types.js";

/**
 * Resolve a channel for a tool, defaulting to the channel the request came from.
 * Refuses anything outside the configured server.
 */
export async function resolveGuildChannel(ctx: ToolContext, channelId?: unknown): Promise<GuildBasedChannel> {
  const id = channelId === undefined || channelId === null || channelId === "" ? ctx.channelId : String(channelId);
  const channel = await ctx.client.channels.fetch(id).catch(() => null);
  if (!channel || channel.isDMBased() || channel.guildId !== ctx.guildId) {
    throw new Error("That channel doesn't exist in this server.");
  }
  return channel as GuildBasedChannel;
}

/** Like resolveGuildChannel, but the channel must be able to receive messages. */
export async function resolveSendableChannel(
  ctx: ToolContext,
  channelId?: unknown,
): Promise<GuildBasedChannel & SendableChannels> {
  const channel = await resolveGuildChannel(ctx, channelId);
  if (!channel.isSendable()) throw new Error("I can't send messages in that kind of channel.");
  return channel as GuildBasedChannel & SendableChannels;
}
