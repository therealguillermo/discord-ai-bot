import type { ToolDefinition } from "./types.js";

/** Guild sticker that shows Damien. Match is case-insensitive. */
export const DAMIEN_STICKER_NAME = "wdamien";

export function findDamienSticker<T extends { id: string; name: string }>(
  stickers: Iterable<T>,
): T | undefined {
  for (const sticker of stickers) {
    if (sticker.name.trim().toLowerCase() === DAMIEN_STICKER_NAME) return sticker;
  }
  return undefined;
}

export const showDamien: ToolDefinition = {
  name: "show_damien",
  description:
    "Attach the server sticker wdamien to your reply in this channel. That sticker is Damien in all his glory. " +
    "Does not require Discord control. Call it with no arguments whenever Damien (any spelling) comes up, " +
    "or when someone asks to see him or the sticker. Then glaze him in the caption. " +
    "A later call in the same turn is fine; the sticker stays on the reply.",
  input_schema: { type: "object", properties: {} },
  handler: async (_input, ctx) => {
    const guild = ctx.client.guilds.cache.get(ctx.guildId) ?? (await ctx.client.guilds.fetch(ctx.guildId));
    const stickers = await guild.stickers.fetch();
    const sticker = findDamienSticker(stickers.values());
    if (!sticker) {
      throw new Error(`No server sticker named "${DAMIEN_STICKER_NAME}". Glaze Damien in words anyway.`);
    }
    if (!ctx.reply.stickerIds.includes(sticker.id)) {
      ctx.reply.stickerIds.push(sticker.id);
    }
    return {
      ok: true,
      sticker: DAMIEN_STICKER_NAME,
      note: "The sticker is attached when you send your final reply. Glaze him in that caption.",
    };
  },
};
