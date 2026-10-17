import Anthropic from "@anthropic-ai/sdk";
import type { Message, SendableChannels } from "discord.js";
import { config } from "../config.js";

/** Posted when a turn finishes with nothing to say. */
export const MISSING_REPLY = "Something went wrong and I don't have an answer. Ask me again.";

const NO_MENTIONS = { parse: [] as never[] };

export function failureText(err: unknown, voice: "plain" | "sassy" = "plain"): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return voice === "sassy"
      ? "Ah mate, the Anthropic API key got rejected. Check ANTHROPIC_API_KEY."
      : "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return voice === "sassy"
      ? "Oi, Anthropic's rate limitin' me. Give it a moment and try again."
      : "The model is rate limiting me. Give it a moment and try again.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return voice === "sassy"
      ? `The model "${config.model}" wasn't found, mate. Check ANTHROPIC_MODEL.`
      : `The model "${config.model}" wasn't found. Check ANTHROPIC_MODEL.`;
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status ?? "unknown"}): ${err.message}`.slice(0, 500);
  }
  const detail = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim() || "unknown error";
  const line =
    voice === "sassy" ? `Somethin' went wrong, mate: ${detail}` : `Something went wrong before I could answer: ${detail}`;
  return line.slice(0, 500);
}

/**
 * Answer the message that woke the bot. Falls back to a plain channel send.
 * Never throws — a dead Discord call must not swallow the attempt.
 */
export async function replyToMessage(
  message: Message,
  channel: SendableChannels | null,
  text: string,
): Promise<void> {
  const content = (text.trim() || MISSING_REPLY).slice(0, 1900);
  const payload = { content, allowedMentions: NO_MENTIONS };
  try {
    await message.reply(payload);
    return;
  } catch (err) {
    console.error("[reply] could not reply to the message:", err);
  }
  if (!channel) return;
  try {
    await channel.send(payload);
  } catch (err) {
    console.error("[reply] could not send to the channel:", err);
  }
}
