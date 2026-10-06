import type { APIEmbed, APIEmbedField } from "discord.js";
import { UserError } from "../features/types.js";
import type { ToolDefinition } from "./types.js";

const LIMIT = {
  embeds: 10,
  title: 256,
  description: 4096,
  author: 256,
  footer: 2048,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  content: 2000,
  total: 6000,
} as const;

export type ReplyEmbeds = {
  content?: string;
  embeds: APIEmbed[];
};

/** Turn a loose tool payload into Discord embed objects. Throws UserError on invalid input. */
export function buildReplyEmbeds(input: Record<string, unknown>): ReplyEmbeds {
  const content = optionalText(input.content, "content", LIMIT.content);
  const rawEmbeds = embedSources(input);
  if (rawEmbeds.length < 1 || rawEmbeds.length > LIMIT.embeds) {
    throw new UserError(`embeds must contain 1 to ${LIMIT.embeds} embeds.`);
  }

  const embeds = rawEmbeds.map((raw, i) => buildOne(asRecord(raw, `embeds[${i}]`), i));
  const total = embeds.reduce((n, embed) => n + embedChars(embed), 0);
  if (total > LIMIT.total) {
    throw new UserError(`Embed text is ${total} characters. Discord allows ${LIMIT.total} across the message.`);
  }
  return { content, embeds };
}

export const postEmbed: ToolDefinition = {
  name: "post_embed",
  description:
    "Attach a rich embed to your reply in this channel. Does not require Discord control. " +
    "Pass one embed at the top level, or embeds: [ ... ] for up to 10. " +
    "Each embed may include title, url, description, color, timestamp, author, footer, fields, thumbnail_url, and image_url. " +
    "Copy values from tool results; do not invent stats. A later call in the same turn replaces the embed. " +
    "After this tool succeeds, reply with one short caption — the embed is added to that message.",
  input_schema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Optional text above the embed (max 2000). Omit to use your final reply as the caption.",
      },
      embeds: {
        type: "array",
        description: "1-10 embeds. Omit this and pass title/description/fields/images at the top level for a single embed.",
        items: { type: "object" },
      },
      title: { type: "string", description: "Max 256 characters." },
      description: { type: "string", description: "Max 4096 characters. Markdown is ok." },
      url: { type: "string", description: "http(s) link on the title." },
      color: { description: "Hex string (#F84982) or integer 0-16777215.", type: "string" },
      timestamp: { type: "string", description: "ISO-8601 time, or 'now'." },
      author: {
        description: "Name string, or { name, url?, icon_url? }.",
        type: "object",
        properties: {
          name: { type: "string" },
          url: { type: "string" },
          icon_url: { type: "string" },
        },
      },
      footer: {
        description: "Text string, or { text, icon_url? }.",
        type: "object",
        properties: {
          text: { type: "string" },
          icon_url: { type: "string" },
        },
      },
      thumbnail_url: { type: "string", description: "Small image URL (avatar)." },
      image_url: { type: "string", description: "Large image URL." },
      fields: {
        type: "array",
        description: "Up to 25. name max 256, value max 1024.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
            inline: { type: "boolean" },
          },
          required: ["name", "value"],
        },
      },
    },
  },
  handler: async (input, ctx) => {
    const built = buildReplyEmbeds(input);
    ctx.reply.set(built);
    return {
      ok: true,
      embeds: built.embeds.length,
      content: built.content ?? null,
      note: "The embed is attached when you send your final reply. Keep that caption short.",
    };
  },
};

function embedSources(input: Record<string, unknown>): unknown[] {
  const flatKeys = [
    "title",
    "description",
    "url",
    "color",
    "timestamp",
    "author",
    "footer",
    "fields",
    "thumbnail_url",
    "image_url",
    "thumbnail",
    "image",
  ];
  const hasFlat = flatKeys.some((key) => input[key] != null && input[key] !== "");
  if (input.embeds != null && hasFlat) {
    throw new UserError("Pass embeds, or one embed at the top level, not both.");
  }
  if (input.embeds == null) {
    if (!hasFlat) throw new UserError("Add a title, description, fields, or an image.");
    return [input];
  }
  if (Array.isArray(input.embeds)) return input.embeds;
  if (typeof input.embeds === "object") return [input.embeds];
  throw new UserError("embeds must be an array of embed objects.");
}

function buildOne(raw: Record<string, unknown>, index: number): APIEmbed {
  const where = `embed ${index + 1}`;
  const title = optionalText(raw.title, `${where} title`, LIMIT.title);
  const description = optionalText(raw.description, `${where} description`, LIMIT.description);
  const url = optionalUrl(raw.url, `${where} url`);
  const color = optionalColor(raw.color, where);
  const timestamp = optionalTimestamp(raw.timestamp, where);
  const author = optionalAuthor(raw.author, where);
  const footer = optionalFooter(raw.footer, where);
  const thumbnail = imageOf(raw.thumbnail_url ?? raw.thumbnail, `${where} thumbnail`);
  const image = imageOf(raw.image_url ?? raw.image, `${where} image`);
  const fields = optionalFields(raw.fields, where);

  if (!title && !description && !author && !footer && !thumbnail && !image && !fields?.length) {
    throw new UserError(`${where} is empty. Add a title, description, fields, or an image.`);
  }
  if (url && !title) throw new UserError(`${where} url needs a title.`);

  const embed: APIEmbed = {};
  if (title) embed.title = title;
  if (description) embed.description = description;
  if (url) embed.url = url;
  if (color != null) embed.color = color;
  if (timestamp) embed.timestamp = timestamp;
  if (author) embed.author = author;
  if (footer) embed.footer = footer;
  if (thumbnail) embed.thumbnail = thumbnail;
  if (image) embed.image = image;
  if (fields?.length) embed.fields = fields;
  return embed;
}

function optionalFields(value: unknown, where: string): APIEmbedField[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new UserError(`${where} fields must be an array.`);
  if (value.length > LIMIT.fields) {
    throw new UserError(`${where} has ${value.length} fields. Discord allows ${LIMIT.fields}.`);
  }
  return value.map((field, i) => {
    const row = asRecord(field, `${where} fields[${i}]`);
    const name = requiredText(row.name, `${where} fields[${i}].name`, LIMIT.fieldName);
    const text = requiredText(row.value, `${where} fields[${i}].value`, LIMIT.fieldValue);
    return { name, value: text, inline: row.inline === true || row.inline === "true" };
  });
}

function optionalAuthor(value: unknown, where: string): APIEmbed["author"] {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    return { name: requiredText(value, `${where} author`, LIMIT.author) };
  }
  const row = asRecord(value, `${where} author`);
  const name = requiredText(row.name, `${where} author.name`, LIMIT.author);
  const url = optionalUrl(row.url, `${where} author.url`);
  const iconURL = optionalUrl(row.icon_url ?? row.iconURL, `${where} author.icon_url`);
  return { name, url, icon_url: iconURL };
}

function optionalFooter(value: unknown, where: string): APIEmbed["footer"] {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    return { text: requiredText(value, `${where} footer`, LIMIT.footer) };
  }
  const row = asRecord(value, `${where} footer`);
  const text = requiredText(row.text ?? row.name, `${where} footer.text`, LIMIT.footer);
  const iconURL = optionalUrl(row.icon_url ?? row.iconURL, `${where} footer.icon_url`);
  return { text, icon_url: iconURL };
}

function imageOf(value: unknown, label: string): { url: string } | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") return { url: requiredUrl(value, label) };
  const row = asRecord(value, label);
  return { url: requiredUrl(row.url, label) };
}

function optionalColor(value: unknown, where: string): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
  const text = String(value).trim();
  const hex = text.replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new UserError(`${where} color must be a hex color like #F84982 or an integer from 0 to 16777215.`);
  }
  return Number.parseInt(hex, 16);
}

function optionalTimestamp(value: unknown, where: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (value === true || value === "now") return new Date().toISOString();
  const text = String(value).trim();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new UserError(`${where} timestamp must be ISO-8601 or 'now'.`);
  return date.toISOString();
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  if (value == null || value === "") return undefined;
  return clip(textOf(value, label), label, max);
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = textOf(value, label).trim();
  if (!text) throw new UserError(`${label} is required.`);
  return clip(text, label, max);
}

function clip(text: string, label: string, max: number): string {
  if (text.length > max) throw new UserError(`${label} is ${text.length} characters. Max is ${max}.`);
  return text;
}

function textOf(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new UserError(`${label} must be text.`);
}

function optionalUrl(value: unknown, label: string): string | undefined {
  if (value == null || value === "") return undefined;
  return requiredUrl(value, label);
}

function requiredUrl(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UserError(`${label} must be an http(s) URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UserError(`${label} must be an http(s) URL.`);
  }
  return text;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function embedChars(embed: APIEmbed): number {
  const fields = embed.fields ?? [];
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.author?.name?.length ?? 0) +
    (embed.footer?.text?.length ?? 0) +
    fields.reduce((n, field) => n + field.name.length + field.value.length, 0)
  );
}
