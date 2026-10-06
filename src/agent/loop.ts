import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { anthropicTools, runTool } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { hideJobRefusal } from "./offJob.js";
import { buildSystemPrompt } from "./prompt.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

/** Per-channel conversation memory: only user requests and final replies (no tool traffic). */
const histories = new Map<string, Anthropic.MessageParam[]>();
/** Serialize runs per channel so history and confirmations never interleave. */
const locks = new Map<string, Promise<unknown>>();

export interface AgentRequest {
  /** Key for conversation memory (channel or thread ID). */
  channelKey: string;
  requesterName: string;
  text: string;
  guildName: string;
  botName: string;
  ctx: ToolContext;
  /** Called with short status text while tools run. */
  onProgress?: (status: string) => Promise<void> | void;
}

export interface AgentResult {
  text: string;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
}

export function runAgent(req: AgentRequest): Promise<AgentResult> {
  const previous = locks.get(req.channelKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => execute(req));
  locks.set(req.channelKey, next);
  next.finally(() => {
    if (locks.get(req.channelKey) === next) locks.delete(req.channelKey);
  }).catch(() => undefined);
  return next;
}

function trimHistory(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  let trimmed = history.slice(-config.historyWindow);
  // Conversation must start with a user turn.
  while (trimmed.length && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  return trimmed;
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function execute(req: AgentRequest): Promise<AgentResult> {
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildSystemPrompt({ guildName: req.guildName, guildId: req.ctx.guildId, botName: req.botName, ownerId: config.ownerId }),
      cache_control: { type: "ephemeral" },
    },
  ];
  const tools = anthropicTools();

  const userText =
    `[Request from ${req.requesterName} (user ID ${req.ctx.requesterId}) in channel ID ${req.ctx.channelId} | discord control: ${req.ctx.discordControl ? "yes" : "no"}]\n${req.text}`;
  const history = trimHistory(histories.get(req.channelKey) ?? []).map((turn) => {
    if (turn.role !== "assistant" || typeof turn.content !== "string") return turn;
    const cleaned = hideJobRefusal(turn.content, `${req.channelKey}\n${turn.content}`);
    return cleaned === turn.content ? turn : { ...turn, content: cleaned };
  });
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userText }];

  let inputTokens = 0;
  let outputTokens = 0;
  let usedTools = false;
  let finalText = "";
  let iterations = 0;
  let stopNote = "";

  for (; iterations < config.maxIterations; ) {
    iterations++;
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxOutputTokens,
      system,
      tools,
      messages,
    });
    inputTokens +=
      response.usage.input_tokens +
      (response.usage.cache_creation_input_tokens ?? 0) +
      (response.usage.cache_read_input_tokens ?? 0);
    outputTokens += response.usage.output_tokens;

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      finalText = textOf(response.content);
      if (response.stop_reason === "max_tokens") stopNote = "\n(Response was cut off: output token limit reached.)";
      break;
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    usedTools = true;
    await req.onProgress?.(`Still goin'... (${toolUses.map((t) => t.name).join(", ")})`);

    // Sequential on purpose: confirmation prompts must not stack up.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      results.push(await runTool(toolUse, req.ctx));
    }
    messages.push({ role: "user", content: results });

    if (inputTokens + outputTokens > config.maxTurnTokens) {
      stopNote = "\n(Stopped: token budget for a single request was reached.)";
      finalText = textOf(response.content);
      break;
    }
    if (iterations >= config.maxIterations) {
      stopNote = "\n(Stopped: maximum number of tool iterations reached; the task may be incomplete.)";
      finalText = textOf(response.content);
    }
  }

  const raw = `${finalText || (req.ctx.reply.embeds.length ? "" : "Done, mate.")}${stopNote}`.trim();
  const text = usedTools ? raw : hideJobRefusal(raw, `${req.channelKey}\n${userText}`);

  const updated = [...history, { role: "user" as const, content: userText }, { role: "assistant" as const, content: text }];
  histories.set(req.channelKey, trimHistory(updated));

  return { text, iterations, inputTokens, outputTokens };
}

export function clearHistory(channelKey: string): void {
  histories.delete(channelKey);
}
