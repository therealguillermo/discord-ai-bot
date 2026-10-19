/**
 * Read vs change for one shell command.
 * A read runs immediately. Anything this cannot prove is read-only is a change
 * and must be confirmed. Confirmation is the only gate: after the owner approves,
 * the command still runs.
 */

export type ShellRisk = "read" | "change";

const SHELLS = new Set(["sh", "bash", "dash", "zsh", "ash", "ksh"]);

const ANY_READ = new Set([
  "ls", "dir", "vdir", "pwd", "tree", "realpath", "readlink", "basename", "dirname",
  "stat", "file", "wc", "du", "df", "lsattr", "getfacl", "namei", "cat", "tac",
  "head", "tail", "less", "more", "nl", "bat", "strings", "od", "hexdump", "xxd",
  "rev", "fold", "fmt", "grep", "egrep", "fgrep", "rg", "ag", "zgrep", "zcat",
  "bzcat", "xzcat", "lzcat", "cut", "sort", "uniq", "tr", "column", "paste", "join",
  "comm", "diff", "cmp", "md5sum", "sha1sum", "sha256sum", "sha512sum", "cksum",
  "b2sum", "date", "uptime", "hostname", "uname", "whoami", "id", "groups", "users",
  "w", "who", "last", "lastlog", "pinky", "env", "printenv", "ps", "pgrep", "pidof",
  "pstree", "free", "vmstat", "iostat", "mpstat", "lscpu", "lsmem", "lsmod", "lspci",
  "lsusb", "lsof", "lsblk", "blkid", "findmnt", "lslogins", "ss", "netstat", "which",
  "whereis", "true", "false", ":", "echo", "printf", "history", "dmesg", "cd",
  "pushd", "popd", "dirs", "export", "unset", "alias", "unalias", "type", "logname",
  "tty", "arch", "nproc", "getconf", "locale", "dig", "nslookup", "host",
]);

const GIT_READ = new Set([
  "status", "log", "diff", "show", "rev-parse", "ls-files", "blame", "shortlog",
  "describe", "grep", "cat-file", "rev-list", "show-ref", "ls-remote", "check-ignore",
  "merge-base", "name-rev", "version", "help", "whatchanged", "reflog",
]);

const TMUX_READ = new Set([
  "ls", "list-sessions", "lsw", "list-windows", "lsp", "list-panes", "lsc", "list-clients",
  "lscm", "list-commands", "capture-pane", "capturep", "display-message", "display",
  "show-options", "show", "showw", "show-window-options", "show-environment", "showenv",
  "has-session", "has", "info", "list-keys", "lsk", "list-buffers", "lsb", "show-buffer",
  "showb", "show-messages",
]);

const NAMED_KEYS = new Set([
  "Enter", "Escape", "Esc", "Space", "Tab", "BTab", "BSpace", "DC", "IC",
  "Up", "Down", "Left", "Right", "Home", "End", "PgUp", "PgDn", "PPage", "NPage",
  "KPEnter", "Insert", "Delete", "PageUp", "PageDown", "Backspace", "WheelUp", "WheelDown",
  ...Array.from({ length: 20 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `KP${i}`),
]);

const SUBMIT_KEYS = new Set(["Enter", "KPEnter", "C-m", "C-j"]);

export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function shellRisk(script: string): ShellRisk {
  return scan(script, 0, script.length) ? "read" : "change";
}

function base(argv0: string): string {
  const slash = Math.max(argv0.lastIndexOf("/"), argv0.lastIndexOf("\\"));
  return slash >= 0 ? argv0.slice(slash + 1) : argv0;
}

function scan(input: string, start: number, end: number): boolean {
  const segments: string[] = [];
  let buf = "";
  let i = start;
  let quote: "'" | '"' | null = null;

  const flush = () => {
    segments.push(buf);
    buf = "";
  };

  while (i < end) {
    const c = input[i] ?? "";
    if (quote === "'") {
      buf += c;
      if (c === "'") quote = null;
      i++;
      continue;
    }
    if (quote === '"') {
      if (c === "\\" && i + 1 < end) {
        buf += c + (input[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === '"') quote = null;
      if (c === "$" && input[i + 1] === "(") {
        if (!takeSubstitution(input, i)) return false;
        const close = closeOf(input, i);
        if (close < 0) return false;
        buf += " ";
        i = close + 1;
        continue;
      }
      if (c === "`") {
        const close = findBacktick(input, i + 1, end);
        if (close < 0 || !scan(input, i + 1, close)) return false;
        buf += " ";
        i = close + 1;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    if (c === "\\" && i + 1 < end) {
      buf += c + (input[i + 1] ?? "");
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      buf += c;
      i++;
      continue;
    }
    if (c === "`") {
      const close = findBacktick(input, i + 1, end);
      if (close < 0 || !scan(input, i + 1, close)) return false;
      buf += " ";
      i = close + 1;
      continue;
    }
    if (c === "$" && input[i + 1] === "(") {
      if (!takeSubstitution(input, i)) return false;
      const close = closeOf(input, i);
      if (close < 0) return false;
      buf += " ";
      i = close + 1;
      continue;
    }
    if (c === ">" && input[i + 1] === "(") return false;
    if (c === "<" && input[i + 1] === "(") {
      const close = findClose(input, i + 1, end);
      if (close < 0 || !scan(input, i + 2, close)) return false;
      i = close + 1;
      continue;
    }
    if (c === ">" && input[i + 1] === "&") {
      const after = i + 2;
      if (after < end && (/[0-9]/.test(input[after] ?? "") || input[after] === "-")) {
        i = after + 1;
        while (i < end && /[0-9]/.test(input[i] ?? "")) i++;
        continue;
      }
      return false;
    }
    if (c === ">" || (c === "&" && input[i + 1] === ">")) return false;
    if (c === "<") {
      i++;
      continue;
    }
    if ((c === "&" && input[i + 1] === "&") || (c === "|" && input[i + 1] === "|")) {
      flush();
      i += 2;
      continue;
    }
    if (c === "|" && input[i + 1] === "&") {
      flush();
      i += 2;
      continue;
    }
    if (c === "|" || c === ";" || c === "\n" || c === "\r") {
      flush();
      i++;
      continue;
    }
    if (c === "&") return false;
    buf += c;
    i++;
  }
  if (quote) return false;
  flush();
  return segments.every((segment) => simpleIsReadOnly(segment));
}

/** `$((...))` is arithmetic. `$(...)` is a command whose body must itself be read-only. */
function takeSubstitution(input: string, dollar: number): boolean {
  if (input[dollar + 2] === "(") return true;
  const close = findClose(input, dollar + 1, input.length);
  if (close < 0) return false;
  return scan(input, dollar + 2, close);
}

function closeOf(input: string, dollar: number): number {
  return findClose(input, dollar + 1, input.length);
}

function findClose(input: string, openParen: number, end: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = openParen; i < end; i++) {
    const c = input[i] ?? "";
    if (quote === "'") {
      if (c === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') quote = null;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findBacktick(input: string, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    if (input[i] === "\\") {
      i++;
      continue;
    }
    if (input[i] === "`") return i;
  }
  return -1;
}

function simpleIsReadOnly(segment: string): boolean {
  if (!segment.trim()) return true;
  const unwrapped = unwrap(words(segment));
  if (!unwrapped) return false;
  if (unwrapped.length === 0) return true;
  return argvIsReadOnly(unwrapped);
}

function words(segment: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let i = 0;
  const push = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  while (i < segment.length) {
    const c = segment[i] ?? "";
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
      i++;
      continue;
    }
    if (quote === '"') {
      if (c === "\\" && i + 1 < segment.length) {
        const n = segment[i + 1] ?? "";
        if (n === '"' || n === "\\" || n === "$" || n === "`") {
          cur += n;
          i += 2;
          continue;
        }
      }
      if (c === '"') quote = null;
      else if (c === "$" && segment[i + 1] === "(") {
        const close = findClose(segment, i + 1, segment.length);
        i = close < 0 ? segment.length : close + 1;
        continue;
      } else if (c === "`") {
        const close = findBacktick(segment, i + 1, segment.length);
        i = close < 0 ? segment.length : close + 1;
        continue;
      } else cur += c;
      i++;
      continue;
    }
    if (c === "\\" && i + 1 < segment.length) {
      cur += segment[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      i++;
      continue;
    }
    if (c === "$" && segment[i + 1] === "(") {
      const close = findClose(segment, i + 1, segment.length);
      i = close < 0 ? segment.length : close + 1;
      continue;
    }
    if (c === "`") {
      const close = findBacktick(segment, i + 1, segment.length);
      i = close < 0 ? segment.length : close + 1;
      continue;
    }
    if (/\s/.test(c)) {
      push();
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  push();
  return out;
}

function unwrap(argv: string[]): string[] | null {
  let args = argv;
  for (;;) {
    if (args.length === 0) return args;
    const cmd = base(args[0] ?? "");
    if (cmd === "sudo" || cmd === "doas") {
      const next = unwrapSudo(args);
      if (!next) return null;
      args = next;
      continue;
    }
    if (cmd === "command" || cmd === "exec" || cmd === "time") {
      args = stripLeadingFlags(args.slice(1));
      continue;
    }
    if (cmd === "nice") {
      args = stripNice(args.slice(1));
      continue;
    }
    if (SHELLS.has(cmd)) {
      const script = shellScript(args.slice(1));
      if (script === null) return null;
      return shellRisk(script) === "read" ? ["true"] : null;
    }
    return stripEnv(args);
  }
}

function stripEnv(args: string[]): string[] {
  let i = 0;
  while (i < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[i] ?? "")) i++;
  return args.slice(i);
}

function unwrapSudo(argv: string[]): string[] | null {
  let i = 1;
  while (i < argv.length) {
    const a = argv[i] ?? "";
    if (a === "--") {
      i++;
      break;
    }
    if (!a.startsWith("-")) break;
    if (a === "-b" || a === "--background" || a === "-i" || a === "--login" || a === "-s" || a === "--shell") {
      return null;
    }
    const valued = new Set([
      "-u", "-g", "-p", "-C", "-D", "-h", "-T", "-R",
      "--user", "--group", "--prompt", "--close-from", "--chdir", "--role", "--type", "--host",
    ]);
    if (valued.has(a)) {
      i += 2;
      continue;
    }
    i++;
  }
  if (i >= argv.length) return null;
  return argv.slice(i);
}

function stripLeadingFlags(args: string[]): string[] {
  let i = 0;
  while (i < args.length && (args[i] ?? "").startsWith("-")) {
    if (args[i] === "--") {
      i++;
      break;
    }
    i++;
  }
  return args.slice(i);
}

function stripNice(args: string[]): string[] {
  let i = 0;
  while (i < args.length) {
    const a = args[i] ?? "";
    if (a === "-n" || a === "--adjustment") {
      i += 2;
      continue;
    }
    if (a.startsWith("-")) {
      i++;
      continue;
    }
    break;
  }
  return args.slice(i);
}

function shellScript(args: string[]): string | null {
  let i = 0;
  while (i < args.length) {
    const a = args[i] ?? "";
    if (a === "--") return null;
    if (a === "-c") return args[i + 1] ?? "";
    if (a.startsWith("-") && a.endsWith("c")) return args[i + 1] ?? "";
    if (a.startsWith("-")) {
      i++;
      continue;
    }
    return null;
  }
  return null;
}

function argvIsReadOnly(argv: string[]): boolean {
  const cmd = base(argv[0] ?? "");
  switch (cmd) {
    case "find":
      return findIsRead(argv);
    case "sed":
      return sedIsRead(argv);
    case "awk":
      return awkIsRead(argv);
    case "git":
      return gitIsRead(argv);
    case "tmux":
      return tmuxIsRead(argv.slice(1));
    case "systemctl":
      return systemctlIsRead(argv);
    case "journalctl":
      return journalctlIsRead(argv);
    case "ip":
      return ipIsRead(argv);
    case "docker":
    case "podman":
      return dockerIsRead(argv);
    case "apt":
      return aptIsRead(argv);
    case "dpkg":
      return dpkgIsRead(argv);
    case "rpm":
      return rpmIsRead(argv);
    case "crontab":
      return crontabIsRead(argv);
    case "mount":
      return mountIsRead(argv);
    case "ping":
    case "ping6":
      return pingIsRead(argv);
    case "top":
      return topIsRead(argv);
    case "hostnamectl":
    case "timedatectl":
    case "localectl":
      return statusCtl(argv);
    default:
      return ANY_READ.has(cmd);
  }
}

function findIsRead(argv: string[]): boolean {
  const write = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);
  return !argv.slice(1).some((arg) => write.has(arg));
}

function sedIsRead(argv: string[]): boolean {
  const scripts: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "-i" || arg.startsWith("-i") || arg === "--in-place" || arg.startsWith("--in-place=")) return false;
    if (arg === "-f" || arg === "--file" || arg.startsWith("--file=")) return false;
    if (arg === "-e" || arg === "--expression") {
      scripts.push(argv[++i] ?? "");
      continue;
    }
    if (arg.startsWith("-e") && arg.length > 2) {
      scripts.push(arg.slice(2));
      continue;
    }
    if (arg.startsWith("-")) continue;
    scripts.push(arg);
    break;
  }
  return scripts.every(
    (script) => !/(^|[;{}])\s*[wWeE](\s|$)/.test(script) && !/\/e(\s|$)/.test(script),
  );
}

function awkIsRead(argv: string[]): boolean {
  const programIsRead = (program: string) => !/system\s*\(|>>|print\s*>/.test(program);
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "-f" || arg === "--file" || arg.startsWith("--file=")) return false;
    if (arg === "-e" || arg === "--source") {
      if (!programIsRead(argv[++i] ?? "")) return false;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return programIsRead(arg);
  }
  return true;
}

function gitIsRead(argv: string[]): boolean {
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      i++;
      break;
    }
    if (!arg.startsWith("-")) break;
    if (arg === "-C" || arg === "--git-dir" || arg === "--work-tree" || arg === "-c" || arg === "--namespace") {
      i += 2;
      continue;
    }
    i++;
  }
  const sub = argv[i];
  if (!sub) return false;
  if (GIT_READ.has(sub)) return true;
  const rest = argv.slice(i + 1);
  if (sub === "branch") return gitBranchRead(rest);
  if (sub === "tag") return gitListOnly(rest);
  if (sub === "stash") return rest[0] === "list" || rest[0] === "show";
  if (sub === "remote") return gitRemoteRead(rest);
  if (sub === "config") return gitConfigRead(rest);
  if (sub === "symbolic-ref") return rest.filter((arg) => !arg.startsWith("-")).length <= 1;
  return false;
}

function gitBranchRead(args: string[]): boolean {
  const write = new Set([
    "-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "--force", "-f",
    "--set-upstream-to", "-u", "--unset-upstream", "--edit-description",
  ]);
  let list = false;
  let positional = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (write.has(arg) || arg.startsWith("--set-upstream")) return false;
    if (arg === "--list" || arg === "-l") list = true;
    if (["--contains", "--no-contains", "--merged", "--no-merged", "--sort", "--format", "--points-at"].includes(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    positional++;
  }
  return positional === 0 || list;
}

function gitListOnly(args: string[]): boolean {
  let list = false;
  let positional = 0;
  for (const arg of args) {
    if (arg === "-d" || arg === "--delete" || arg === "-f" || arg === "--force") return false;
    if (arg === "--list" || arg === "-l") list = true;
    else if (!arg.startsWith("-")) positional++;
  }
  return positional === 0 || list;
}

function gitRemoteRead(args: string[]): boolean {
  const sub = args.find((arg) => !arg.startsWith("-"));
  return sub === undefined || sub === "show" || sub === "get-url" || sub === "-v";
}

function gitConfigRead(args: string[]): boolean {
  if (args.some((arg) => ["--unset", "--unset-all", "--add", "--replace-all", "--rename-section", "--remove-section"].includes(arg))) {
    return false;
  }
  const positional = args.filter((arg) => !arg.startsWith("-"));
  if (args.some((arg) => ["--get", "--list", "--get-regexp", "--get-all", "-l", "--show-origin", "--show-scope"].includes(arg))) {
    return positional.length <= 1;
  }
  return positional.length === 1;
}

function tmuxIsRead(args: string[]): boolean {
  let i = 0;
  while (i < args.length && (args[i] ?? "").startsWith("-")) {
    const flag = args[i] ?? "";
    if (flag === "--") {
      i++;
      break;
    }
    if (flag === "-L" || flag === "-S" || flag === "-f" || flag === "-T" || flag === "-c") {
      i += 2;
      continue;
    }
    i++;
  }
  const sub = args[i];
  if (!sub) return false;
  if (TMUX_READ.has(sub)) return true;
  if (sub === "send-keys" || sub === "send") return sendKeysAreRead(args.slice(i + 1));
  return false;
}

function sendKeysAreRead(args: string[]): boolean {
  let literal = false;
  const keys: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      keys.push(...args.slice(i + 1));
      break;
    }
    if (arg === "-l") {
      literal = true;
      continue;
    }
    if (arg === "-H" || arg === "-F") continue;
    if (arg === "-R" || arg === "-M" || arg === "-X") return false;
    if (arg === "-t" || arg === "-c" || arg === "-N") {
      i++;
      continue;
    }
    if (arg.startsWith("-")) return false;
    keys.push(arg);
  }
  return keysAreReadOnly(keys, literal);
}

function isNamedKey(token: string): boolean {
  return NAMED_KEYS.has(token) || /^(?:\^|(?:C-|M-|S-)+).+/.test(token);
}

function keysAreReadOnly(keys: string[], literal: boolean): boolean {
  const lines: string[] = [];
  let current = "";
  let submitted = false;
  const submit = () => {
    submitted = true;
    lines.push(current);
    current = "";
  };
  for (const key of keys) {
    if (!literal && isNamedKey(key)) {
      if (SUBMIT_KEYS.has(key)) submit();
      else return false;
      continue;
    }
    const parts = key.split(/\r?\n/);
    current += parts[0] ?? "";
    for (let part = 1; part < parts.length; part++) {
      submit();
      current += parts[part] ?? "";
    }
  }
  if (!submitted) return true;
  return lines.every((line) => line.trim() !== "" && shellRisk(line.trim()) === "read");
}

const SYSTEMCTL_READ = new Set([
  "status", "is-active", "is-failed", "is-enabled", "is-system-running", "list-units",
  "list-unit-files", "list-timers", "list-jobs", "list-dependencies", "show", "cat",
  "get-default", "list-sockets", "show-environment", "help", "--version",
]);

function systemctlIsRead(argv: string[]): boolean {
  const sub = argv.slice(1).find((arg) => !arg.startsWith("-"));
  return sub != null && SYSTEMCTL_READ.has(sub);
}

function journalctlIsRead(argv: string[]): boolean {
  return !argv.some(
    (arg) =>
      arg.startsWith("--vacuum") ||
      arg === "--rotate" ||
      arg === "--flush" ||
      arg === "--sync" ||
      arg === "--setup-keys" ||
      arg === "--relinquish-var",
  );
}

function ipIsRead(argv: string[]): boolean {
  const mutating = new Set(["add", "del", "delete", "set", "change", "replace", "flush", "save", "restore"]);
  const words = argv.slice(1).filter((arg) => !arg.startsWith("-"));
  if (words.some((word) => mutating.has(word))) return false;
  const ok = new Set(["addr", "address", "route", "link", "rule", "neigh", "neighbour", "maddress", "help"]);
  return words.length === 0 || ok.has(words[0] ?? "");
}

function dockerIsRead(argv: string[]): boolean {
  let i = 1;
  while ((argv[i] ?? "").startsWith("-")) i++;
  const sub = argv[i];
  if (sub === "image" || sub === "container") {
    const next = argv[i + 1];
    return next === "ls" || next === "list" || next === "inspect" || next === "logs" || next === "history" || next === "diff";
  }
  if (sub === "stats") return argv.includes("--no-stream");
  return new Set(["ps", "images", "logs", "inspect", "top", "port", "info", "version", "history", "diff"]).has(sub ?? "");
}

function aptIsRead(argv: string[]): boolean {
  const sub = argv.slice(1).find((arg) => !arg.startsWith("-"));
  return new Set(["list", "show", "search", "policy", "depends", "rdepends", "showsrc"]).has(sub ?? "");
}

function dpkgIsRead(argv: string[]): boolean {
  const write = new Set(["-i", "--install", "-r", "--remove", "-P", "--purge", "--configure", "--unpack", "--update-avail", "--merge-avail", "--clear-avail"]);
  if (argv.slice(1).some((arg) => write.has(arg))) return false;
  const read = new Set(["-l", "--list", "-L", "--listfiles", "-s", "--status", "-S", "--search", "-c", "--contents", "-I", "--info", "-p", "--print-avail", "--compare-versions", "--print-architecture", "--version", "-W", "--show", "--get-selections"]);
  return argv.slice(1).some((arg) => read.has(arg) || arg.startsWith("--show"));
}

function rpmIsRead(argv: string[]): boolean {
  if (argv.some((arg) => ["-e", "-U", "-F", "--erase", "--upgrade", "--freshen", "--install"].includes(arg))) return false;
  const query = argv.some((arg) => arg === "-q" || arg === "--query" || (arg.startsWith("-") && arg.includes("q") && !arg.startsWith("--")));
  if (!query) return false;
  return !argv.includes("-i") || query;
}

function crontabIsRead(argv: string[]): boolean {
  let sawList = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "-l" || arg === "--list") {
      sawList = true;
      continue;
    }
    if (arg === "-u" || arg === "--user") {
      i++;
      continue;
    }
    return false;
  }
  return sawList;
}

function mountIsRead(argv: string[]): boolean {
  const ok = new Set(["-l", "--show-labels", "-v", "--verbose", "-f", "--fake"]);
  for (const arg of argv.slice(1)) {
    if (ok.has(arg)) continue;
    return false;
  }
  return true;
}

function pingIsRead(argv: string[]): boolean {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "-c" || arg === "--count" || arg === "-w" || arg === "--deadline") return true;
    if (/^-c\d+$/.test(arg) || /^--count=\d+$/.test(arg)) return true;
  }
  return false;
}

function topIsRead(argv: string[]): boolean {
  const batch = argv.includes("-b") || argv.includes("--batch");
  const once =
    argv.some((arg, index) => (arg === "-n" || arg === "--iterations") && argv[index + 1] === "1") ||
    argv.some((arg) => arg === "-n1" || arg === "--iterations=1");
  return batch && once;
}

function statusCtl(argv: string[]): boolean {
  const words = argv.slice(1).filter((arg) => !arg.startsWith("-"));
  return words.length === 0 || words[0] === "status";
}
