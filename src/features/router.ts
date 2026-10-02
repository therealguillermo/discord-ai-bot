import { Events, type Client, type Message } from "discord.js";
import { config } from "../config.js";
import { audit } from "../safety/confirm.js";
import { UserError, type CommandContext, type Feature, type PrefixCommand } from "./types.js";

const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function buildHelp(features: Feature[]): PrefixCommand {
  return {
    name: "help",
    aliases: ["commands"],
    description: "List the available commands.",
    execute: async (ctx) => {
      const lines: string[] = [];
      for (const feature of features) {
        const cmds = feature.commands ?? [];
        if (cmds.length === 0) continue;
        lines.push(`**${feature.name}**`);
        for (const c of cmds) {
          const usage = c.usage ? ` ${c.usage}` : "";
          lines.push(`\`${ctx.prefix}${c.name}${usage}\` - ${c.description}`);
        }
        lines.push("");
      }
      lines.push(`You can also @mention me to chat or ask me to manage the server (if you're allowed).`);
      await ctx.reply(lines.join("\n").slice(0, 1990));
    },
  };
}

/** Wire all features' prefix commands to message events. */
export function attachRouter(client: Client, features: Feature[]): void {
  const commands = new Map<string, PrefixCommand>();
  const register = (featureName: string, cmd: PrefixCommand) => {
    for (const raw of [cmd.name, ...(cmd.aliases ?? [])]) {
      const key = raw.toLowerCase();
      if (!NAME_RE.test(key)) throw new Error(`Invalid command name "${raw}" in feature ${featureName}.`);
      if (commands.has(key)) throw new Error(`Duplicate command name "${key}" in feature ${featureName}.`);
      commands.set(key, cmd);
    }
  };

  const help = buildHelp(features);
  register("core", help);
  // Show help as its own group at the top of ?help's own listing.
  for (const f of features) for (const c of f.commands ?? []) register(f.name, c);

  const cooldowns = new Map<string, number>();

  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      if (message.author.bot || !message.inGuild()) return;
      if (message.guildId !== config.guildId) return;
      if (!message.content.startsWith(config.prefix)) return;

      const body = message.content.slice(config.prefix.length);
      const [rawName = "", ...args] = body.trim().split(/\s+/);
      const name = rawName.toLowerCase();
      if (!NAME_RE.test(name)) return; // "??", "?!" and chatter: stay silent
      const cmd = commands.get(name);
      if (!cmd) return; // unknown command: stay silent so normal "?" usage isn't noisy

      const reply: CommandContext["reply"] = (content) =>
        message.reply({
          allowedMentions: { parse: [], repliedUser: false },
          ...(typeof content === "string" ? { content } : content),
        });

      // Cooldown.
      if (cmd.cooldownMs) {
        const key = `${cmd.name}:${message.author.id}`;
        const now = Date.now();
        const until = cooldowns.get(key) ?? 0;
        if (now < until) {
          await reply(`Slow down - try again in ${Math.ceil((until - now) / 1000)}s.`);
          return;
        }
        cooldowns.set(key, now + cmd.cooldownMs);
      }

      const ctx: CommandContext = {
        client,
        message,
        args,
        rest: body.trim().slice(rawName.length).trim(),
        prefix: config.prefix,
        reply,
      };

      try {
        await cmd.execute(ctx);
      } catch (err) {
        if (err instanceof UserError) {
          await reply(err.message).catch(() => undefined);
        } else {
          console.error(`[command:${cmd.name}] failed:`, err);
          await audit({
            requesterId: message.author.id,
            channelId: message.channelId,
            tool: `cmd:${cmd.name}`,
            input: message.content,
            outcome: "error",
            detail: err instanceof Error ? err.message : String(err),
          });
          await reply("Something went wrong running that command.").catch(() => undefined);
        }
      }
    } catch (err) {
      console.error("[router] error:", err);
    }
  });
}
