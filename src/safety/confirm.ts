import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type SendableChannels,
} from "discord.js";

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

const LOG_DIR = path.resolve(process.cwd(), "logs");
const AUDIT_FILE = path.join(LOG_DIR, "audit.jsonl");

export interface AuditEntry {
  requesterId: string;
  channelId: string;
  tool: string;
  input: unknown;
  outcome: "ok" | "error" | "denied" | "cancelled";
  detail?: string;
}

function truncate(value: unknown, max = 2000): unknown {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s === undefined) return value;
  return s.length > max ? `${s.slice(0, max)}...[truncated ${s.length - max} chars]` : s;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
      input: truncate(entry.input),
      detail: entry.detail === undefined ? undefined : truncate(entry.detail),
    });
    await appendFile(AUDIT_FILE, `${line}\n`, "utf8");
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

/* -------------------------------------------------------------------------- */
/* Risk classification                                                        */
/* -------------------------------------------------------------------------- */

export type Risk = "safe" | "destructive";

/**
 * Classify a Discord REST call. Anything that deletes, bans/kicks, bulk deletes,
 * or edits roles/permissions/members/guild settings requires human confirmation.
 */
export function classifyRisk(method: string, routePath: string, body?: unknown): Risk {
  const m = method.toUpperCase();
  const p = routePath.toLowerCase();

  if (m === "DELETE") return "destructive";
  if (p.includes("/bans")) return "destructive";
  if (p.includes("/bulk-delete")) return "destructive";
  if (p.includes("/prune")) return "destructive";
  if (m !== "GET" && /\/guilds\/[^/]+\/roles/.test(p)) return "destructive";
  if (m !== "GET" && /\/members\/[^/]+\/roles/.test(p)) return "destructive";
  if (m !== "GET" && /\/members\/[^/]+$/.test(p)) return "destructive";
  if (m !== "GET" && p.includes("/permissions")) return "destructive";
  if (m !== "GET" && /\/guilds\/[^/]+$/.test(p)) return "destructive";
  if (m !== "GET" && /\/guilds\/[^/]+\/(mfa|onboarding|widget|vanity-url)/.test(p)) {
    return "destructive";
  }
  if (
    body &&
    typeof body === "object" &&
    ("permission_overwrites" in body || "permissions" in body)
  ) {
    return "destructive";
  }
  return "safe";
}

/* -------------------------------------------------------------------------- */
/* Confirmation buttons                                                       */
/* -------------------------------------------------------------------------- */

const CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Ask the requesting user to approve an action via buttons.
 * Only the original requester can respond. Resolves false on cancel or timeout.
 */
export async function requestConfirmation(
  channel: SendableChannels,
  requesterId: string,
  summary: string,
): Promise<boolean> {
  const stamp = Date.now().toString(36);
  const confirmId = `confirm:${stamp}`;
  const cancelId = `cancel:${stamp}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel("Confirm").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const prompt = await channel.send({
    content: `<@${requesterId}> The agent wants to perform a potentially destructive action:\n\`\`\`\n${summary.slice(0, 1500)}\n\`\`\`\nConfirm within 60 seconds.`,
    components: [row],
    allowedMentions: { users: [requesterId] },
  });

  try {
    const click = await prompt.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: CONFIRM_TIMEOUT_MS,
      filter: (i) => i.user.id === requesterId && (i.customId === confirmId || i.customId === cancelId),
    });
    const approved = click.customId === confirmId;
    await click.update({
      content: `${approved ? "Confirmed" : "Cancelled"} by <@${requesterId}>:\n\`\`\`\n${summary.slice(0, 1500)}\n\`\`\``,
      components: [],
      allowedMentions: { parse: [] },
    });
    return approved;
  } catch {
    await prompt
      .edit({ content: "Confirmation timed out. Action cancelled.", components: [] })
      .catch(() => undefined);
    return false;
  }
}
