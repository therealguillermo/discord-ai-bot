import { AttachmentBuilder } from "discord.js";
import { config } from "../../config.js";
import { resolveSendableChannel } from "../../tools/channels.js";
import type { ToolDefinition } from "../../tools/types.js";
import type { Feature } from "../types.js";

const MAX_PROMPT = 1000;
const COOLDOWN_MS = 30_000;

interface ImageResponse {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string; code?: string };
}

/** Image generation costs real money, so keep the old per-user cooldown. */
const lastUsed = new Map<string, number>();

const RETRY_DELAY_MS = 2_000;

/**
 * Call OpenAI's image API. This is deliberately independent of the main (Claude) model: its own key,
 * its own model (IMAGE_MODEL), its own errors. Transient failures (network, 429, 5xx) are retried once.
 * Throws Errors with messages that are safe and useful to show the user.
 */
async function requestImage(key: string, prompt: string): Promise<ImageResponse> {
  for (let attempt = 1; ; attempt++) {
    let res: Response | undefined;
    let networkError: unknown;
    try {
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.imageModel, prompt, n: 1, size: "1024x1024" }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      networkError = err;
    }

    if (res?.ok) return (await res.json()) as ImageResponse;

    const body = res ? ((await res.json().catch(() => ({}))) as ImageResponse) : {};
    const code = body.error?.code ?? "";
    const apiMessage = body.error?.message?.slice(0, 300);

    // Don't retry a request that is going to fail the same way.
    if (code === "content_policy_violation" || code === "moderation_blocked") {
      throw new Error("The image service refused that prompt. Try rewording it.");
    }
    if (res?.status === 401) throw new Error("OpenAI rejected the API key. Check OPENAI_API_KEY.");
    if (code === "insufficient_quota" || code === "billing_hard_limit_reached") {
      throw new Error("The OpenAI account is out of credit. Add credit at platform.openai.com.");
    }
    if (res && res.status >= 400 && res.status < 500 && res.status !== 429) {
      // e.g. unknown model, or a model that needs organization verification: the message says which.
      console.error("[image] API error:", res.status, apiMessage);
      throw new Error(`The image service rejected the request (${res.status}): ${apiMessage ?? "no details"}`);
    }

    if (attempt >= 2) {
      console.error("[image] giving up:", res?.status ?? networkError, apiMessage);
      if (networkError instanceof Error && networkError.name === "TimeoutError") {
        throw new Error("Image generation timed out.");
      }
      throw new Error("The image service is having trouble right now. Try again in a moment.");
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
}

const generateImage: ToolDefinition = {
  name: "generate_image",
  description:
    "Generate an AI image from a text prompt and post it in a channel (defaults to the current channel). " +
    "Costs money and has a 30 second cooldown per user, so only call it when an image was actually requested.",
  input_schema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: `What to draw (max ${MAX_PROMPT} characters).` },
      channel_id: { type: "string", description: "Channel to post the image in. Default: the current channel." },
    },
    required: ["prompt"],
  },
  handler: async (input, ctx) => {
    const key = config.openaiApiKey;
    if (!key) {
      throw new Error(
        "The OpenAI key isn't set yet. Tell the user to add OPENAI_API_KEY=... to the bot's .env file and restart the bot, then try again.",
      );
    }
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required.");
    if (prompt.length > MAX_PROMPT) throw new Error(`Keep the prompt under ${MAX_PROMPT} characters.`);

    const channel = await resolveSendableChannel(ctx, input.channel_id);

    // Reserve the cooldown up front (so two simultaneous calls can't both run), but give it back if the
    // request fails: a failed attempt shouldn't lock the user out.
    const previous = lastUsed.get(ctx.requesterId);
    const wait = (previous ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) throw new Error(`Image generation is on cooldown: try again in ${Math.ceil(wait / 1000)}s.`);
    lastUsed.set(ctx.requesterId, Date.now());

    let body: ImageResponse;
    try {
      body = await requestImage(key, prompt);
    } catch (err) {
      if (previous === undefined) lastUsed.delete(ctx.requesterId);
      else lastUsed.set(ctx.requesterId, previous);
      throw err;
    }

    const item = body.data?.[0];
    if (item?.b64_json) {
      const file = new AttachmentBuilder(Buffer.from(item.b64_json, "base64"), { name: "image.png" });
      const sent = await channel.send({ files: [file], allowedMentions: { parse: [] } });
      return { ok: true, message_id: sent.id, channel_id: channel.id };
    }
    if (item?.url) {
      const sent = await channel.send({ content: item.url, allowedMentions: { parse: [] } });
      return { ok: true, message_id: sent.id, channel_id: channel.id };
    }
    throw new Error("The image service didn't return an image.");
  },
};

export const imagesFeature: Feature = {
  name: "Images",
  // Always offered; without OPENAI_API_KEY the tool answers with a clear "not set up" error.
  tools: [generateImage],
};
