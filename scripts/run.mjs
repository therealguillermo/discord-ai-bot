/**
 * Launcher that re-execs under Node 22+ when the shell's `node` is too old,
 * and rebuilds voice native modules (opus) for that Node ABI when needed.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN = [22, 12, 0];
const mode = process.argv[2] === "dev" ? "dev" : "start";

function parseVersion(v) {
  const m = String(v).trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewEnough(v) {
  const parts = parseVersion(v);
  if (!parts) return false;
  for (let i = 0; i < 3; i++) {
    if (parts[i] > MIN[i]) return true;
    if (parts[i] < MIN[i]) return false;
  }
  return true;
}

function versionOf(nodeBin) {
  try {
    const r = spawnSync(nodeBin, ["-p", "process.versions.node"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (r.status !== 0) return null;
    return r.stdout.trim();
  } catch {
    return null;
  }
}

function candidates() {
  const list = [];
  const push = (p) => {
    if (p && existsSync(p) && !list.includes(p)) list.push(p);
  };

  if (process.env.NODE_BINARY) push(process.env.NODE_BINARY);
  push(process.execPath);

  const local = process.env.LOCALAPPDATA || "";
  const home = process.env.USERPROFILE || process.env.HOME || "";

  push(path.join(local, "hermes", "node", "node.exe"));
  push(path.join(local, "hermes", "node", "node"));

  const nvmSymlink =
    process.env.NVM_SYMLINK || path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs");
  push(path.join(nvmSymlink, "node.exe"));

  push("/usr/local/bin/node");
  push(path.join(home, ".local", "share", "fnm", "aliases", "default", "bin", "node"));
  push(path.join(home, ".nvm", "current", "bin", "node"));

  return list;
}

function findNode22() {
  for (const bin of candidates()) {
    const ver = versionOf(bin);
    if (ver && isNewEnough(ver)) return { bin, ver };
  }

  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const args = process.platform === "win32" ? ["node"] : ["-a", "node"];
    const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
    const lines = (r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const bin of lines) {
      const ver = versionOf(bin);
      if (ver && isNewEnough(ver)) return { bin, ver };
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** True if either native opus or opusscript can load under nodeBin. */
function canLoadOpus(nodeBin) {
  const r = spawnSync(
    nodeBin,
    [
      "-e",
      "try{require('@discordjs/opus');process.exit(0)}catch(e){}" +
        "try{require('opusscript');process.exit(0)}catch(e){process.exit(1)}",
    ],
    { windowsHide: true, cwd: ROOT },
  );
  return r.status === 0;
}

function ensureVoiceNatives(nodeBin, ver) {
  if (canLoadOpus(nodeBin)) return;
  console.log(`[run] Rebuilding voice native modules for Node ${ver}…`);
  const env = {
    ...process.env,
    PATH: `${path.dirname(nodeBin)}${path.delimiter}${process.env.PATH || ""}`,
  };
  const r = spawnSync("npm", ["rebuild", "@discordjs/opus", "sodium-native", "@snazzah/davey"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
    env,
  });
  if (r.status !== 0 || !canLoadOpus(nodeBin)) {
    console.error(
      "[run] Could not load an Opus encoder (@discordjs/opus / opusscript). Music will not play.\n" +
        "Try: npm install opusscript && npm run rebuild:native",
    );
  }
}

function startBot(nodeBin, ver, note) {
  if (note) console.log(note);
  ensureVoiceNatives(nodeBin, ver);

  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const scriptArgs =
    mode === "dev"
      ? [tsxCli, "watch", path.join(ROOT, "src", "index.ts")]
      : [tsxCli, path.join(ROOT, "src", "index.ts")];

  const child = spawn(nodeBin, scriptArgs, {
    stdio: "inherit",
    windowsHide: true,
    cwd: ROOT,
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

const current = process.versions.node;
if (!isNewEnough(current)) {
  const found = findNode22();
  if (!found) {
    console.error(
      `[run] Need Node >= ${MIN.join(".")} for Discord voice (DAVE). Current: ${current}.\n` +
        `Install Node 22+ (or Hermes), or set NODE_BINARY to that node.exe, then retry \`npm start\`.`,
    );
    process.exit(1);
  }
  startBot(
    found.bin,
    found.ver,
    `[run] Using Node ${found.ver} at ${found.bin} (shell had ${current})`,
  );
} else {
  startBot(process.execPath, current, null);
}
