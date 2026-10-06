import type Anthropic from "@anthropic-ai/sdk";
import { DiscordControlError } from "../auth.js";
import { featureTools } from "../features/index.js";
import { audit } from "../safety/confirm.js";
import { curatedTools } from "./curated.js";
import { discordCall, discordSearchEndpoints } from "./discordCall.js";
import { postEmbed } from "./embed.js";
import { loadSkill } from "./skills.js";
import type { ToolContext, ToolDefinition } from "./types.js";

export const allTools: ToolDefinition[] = [
  loadSkill,
  postEmbed,
  ...curatedTools,
  ...featureTools,
  discordSearchEndpoints,
  discordCall,
];

const byName = new Map(allTools.map((t) => [t.name, t]));

/** Tool definitions in the shape the Anthropic Messages API expects. */
export function anthropicTools(): Anthropic.Tool[] {
  return allTools.map((t, i) => {
    const tool: Anthropic.Tool = {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    };
    // Cache the (large, static) tool list prefix: mark the last tool as a cache breakpoint.
    if (i === allTools.length - 1) tool.cache_control = { type: "ephemeral" };
    return tool;
  });
}

const MAX_TOOL_RESULT_CHARS = 20_000;

/** Run one tool call and return a tool_result block. Never throws. */
export async function runTool(
  toolUse: { id: string; name: string; input: unknown },
  ctx: ToolContext,
): Promise<Anthropic.ToolResultBlockParam> {
  const tool = byName.get(toolUse.name);
  const input = (toolUse.input && typeof toolUse.input === "object" ? toolUse.input : {}) as Record<string, unknown>;
  const base = { requesterId: ctx.requesterId, channelId: ctx.channelId, tool: toolUse.name, input };

  if (!tool) {
    await audit({ ...base, outcome: "error", detail: "unknown tool" });
    return { type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: `Unknown tool "${toolUse.name}".` };
  }

  try {
    if (tool.requiresDiscordControl && !ctx.discordControl) {
      throw new DiscordControlError();
    }
    if (tool.destructive) {
      const summary = tool.describeAction?.(input) ?? `${tool.name} ${JSON.stringify(input)}`;
      const approved = await ctx.confirm(summary);
      if (!approved) {
        await audit({ ...base, outcome: "cancelled" });
        return {
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: "The requester declined or did not respond to the confirmation. Action was not performed.",
        };
      }
    }
    const result = await tool.handler(input, ctx);
    let content = typeof result === "string" ? result : JSON.stringify(result ?? { ok: true });
    if (content.length > MAX_TOOL_RESULT_CHARS) {
      content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[truncated]`;
    }
    await audit({ ...base, outcome: "ok", detail: content.slice(0, 300) });
    return { type: "tool_result", tool_use_id: toolUse.id, content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const declined = message.includes("declined or did not respond");
    const denied = err instanceof DiscordControlError;
    await audit({
      ...base,
      outcome: denied ? "denied" : declined ? "cancelled" : "error",
      detail: message,
    });
    return { type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: message };
  }
}
