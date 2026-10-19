import { UserError } from "../types.js";
import { shQuote } from "./risk.js";

export type TmuxAction =
  | "list_sessions"
  | "list_windows"
  | "list_panes"
  | "capture"
  | "keys"
  | "new_session"
  | "new_window"
  | "split"
  | "select_window"
  | "select_pane"
  | "resize_pane"
  | "rename_session"
  | "rename_window"
  | "kill_session"
  | "kill_window"
  | "kill_pane";

export interface TmuxInput {
  action: string;
  target?: string;
  text?: string;
  keys?: string[];
  lines?: number;
  session?: string;
  name?: string;
  command?: string;
  cwd?: string;
  direction?: string;
  amount?: number;
}

export interface TmuxCall {
  command: string;
  summary: string;
}

const ACTIONS = new Set<TmuxAction>([
  "list_sessions",
  "list_windows",
  "list_panes",
  "capture",
  "keys",
  "new_session",
  "new_window",
  "split",
  "select_window",
  "select_pane",
  "resize_pane",
  "rename_session",
  "rename_window",
  "kill_session",
  "kill_window",
  "kill_pane",
]);

function quoteJoin(argv: string[]): string {
  return argv.map(shQuote).join(" ");
}

function need(value: string | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new UserError(`${label} is required.`);
  return trimmed;
}

/** Build one tmux command. New sessions and splits are detached so the SSH call returns. */
export function buildTmux(input: TmuxInput): TmuxCall {
  if (!ACTIONS.has(input.action as TmuxAction)) {
    throw new UserError(`Unknown tmux action "${input.action}".`);
  }
  const action = input.action as TmuxAction;
  const target = input.target?.trim() ?? "";
  const session = input.session?.trim() ?? "";
  const name = input.name?.trim() ?? "";
  const cwd = input.cwd?.trim() ?? "";

  switch (action) {
    case "list_sessions":
      return call(
        ["tmux", "list-sessions", "-F", "#{session_name}\t#{session_windows} windows\t#{?session_attached,attached,detached}"],
        "List tmux sessions",
      );
    case "list_windows":
      return call(
        target
          ? ["tmux", "list-windows", "-t", target, "-F", "#{window_index}\t#{window_name}\t#{?window_active,active,}\t#{window_panes} panes"]
          : ["tmux", "list-windows", "-a", "-F", "#{session_name}:#{window_index}\t#{window_name}\t#{?window_active,active,}"],
        target ? `List tmux windows in ${target}` : "List every tmux window",
      );
    case "list_panes":
      return call(
        target
          ? ["tmux", "list-panes", "-t", target, "-F", "#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_command}\t#{pane_width}x#{pane_height}"]
          : ["tmux", "list-panes", "-a", "-F", "#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_command}\t#{pane_width}x#{pane_height}"],
        target ? `List tmux panes in ${target}` : "List every tmux pane",
      );
    case "capture": {
      const where = need(target, "target");
      const lines = input.lines ?? 200;
      return call(
        ["tmux", "capture-pane", "-p", "-J", "-t", where, "-S", `-${lines}`],
        `Read tmux pane ${where}`,
      );
    }
    case "keys": {
      const where = need(target, "target");
      const text = input.text ?? "";
      const keys = input.keys ?? [];
      if (!text && keys.length === 0) throw new UserError("keys needs text, keys, or both.");
      const argv = ["tmux", "send-keys", "-t", where];
      if (text) argv.push(text);
      argv.push(...keys);
      const typed = [text, ...keys].filter(Boolean).join(" ");
      return call(argv, `Type into tmux ${where}: ${typed}`);
    }
    case "new_session": {
      const where = need(session, "session");
      const argv = ["tmux", "new-session", "-d", "-s", where];
      if (cwd) argv.push("-c", cwd);
      if (input.command?.trim()) argv.push("--", "bash", "-lc", input.command.trim());
      return call(argv, `Create detached tmux session ${where}`);
    }
    case "new_window": {
      const where = need(target, "target");
      const argv = ["tmux", "new-window", "-d", "-t", where];
      if (name) argv.push("-n", name);
      if (cwd) argv.push("-c", cwd);
      if (input.command?.trim()) argv.push("--", "bash", "-lc", input.command.trim());
      return call(argv, `Create a tmux window in ${where}`);
    }
    case "split": {
      const where = need(target, "target");
      const direction = input.direction === "vertical" ? "-v" : "-h";
      const argv = ["tmux", "split-window", "-d", direction, "-t", where];
      if (cwd) argv.push("-c", cwd);
      if (input.command?.trim()) argv.push("--", "bash", "-lc", input.command.trim());
      return call(argv, `Split tmux pane ${where}`);
    }
    case "select_window":
      return call(["tmux", "select-window", "-t", need(target, "target")], `Select tmux window ${target}`);
    case "select_pane":
      return call(["tmux", "select-pane", "-t", need(target, "target")], `Select tmux pane ${target}`);
    case "resize_pane": {
      const where = need(target, "target");
      const flag = resizeFlag(input.direction);
      const amount = input.amount ?? 5;
      return call(["tmux", "resize-pane", "-t", where, flag, String(amount)], `Resize tmux pane ${where}`);
    }
    case "rename_session":
      return call(
        ["tmux", "rename-session", "-t", need(target, "target"), need(name, "name")],
        `Rename tmux session ${target} to ${name}`,
      );
    case "rename_window":
      return call(
        ["tmux", "rename-window", "-t", need(target, "target"), need(name, "name")],
        `Rename tmux window ${target} to ${name}`,
      );
    case "kill_session":
      return call(["tmux", "kill-session", "-t", need(target, "target")], `Kill tmux session ${target}`);
    case "kill_window":
      return call(["tmux", "kill-window", "-t", need(target, "target")], `Kill tmux window ${target}`);
    case "kill_pane":
      return call(["tmux", "kill-pane", "-t", need(target, "target")], `Kill tmux pane ${target}`);
  }
}

function resizeFlag(direction: string | undefined): string {
  switch (direction) {
    case "left":
      return "-L";
    case "right":
      return "-R";
    case "up":
      return "-U";
    case "down":
      return "-D";
    default:
      throw new UserError("direction must be left, right, up, or down.");
  }
}

function call(argv: string[], summary: string): TmuxCall {
  const command = quoteJoin(argv);
  return { command, summary: `${summary}\n${command}` };
}
