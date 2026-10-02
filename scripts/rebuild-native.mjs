/**
 * Rebuild voice native addons for the current Node ABI.
 * Needed when switching between Node 18 and Node 22 (opus .node path changes).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgs = ["@discordjs/opus", "sodium-native", "@snazzah/davey"];

console.log(`[rebuild-native] Node ${process.versions.node} — rebuilding ${pkgs.join(", ")}`);
const r = spawnSync("npm", ["rebuild", ...pkgs], {
  cwd: ROOT,
  stdio: "inherit",
  shell: true,
  windowsHide: true,
  env: process.env,
});
process.exit(r.status ?? 1);
