import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../../config.js";
import { UserError } from "../types.js";
import { ytdlpCommonArgs, ytdlpFormatArgs } from "./ytdlp.js";

const execFileAsync = promisify(execFile);

export interface ResolvedMedia {
  title: string;
  pageUrl: string;
  durationSec: number | null;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function pickEntry(info: any): any {
  if (!info) return null;
  if (info.entries && Array.isArray(info.entries) && info.entries.length) {
    return info.entries.find((e: any) => e && (e.url || e.formats || e.id)) ?? info.entries[0];
  }
  return info;
}

/** Resolve a URL or search query to metadata via yt-dlp (playback streams the page URL separately). */
export async function resolveQuery(query: string): Promise<ResolvedMedia> {
  const q = query.trim();
  if (!q) throw new UserError("Give a song URL or search text.");

  const target = isHttpUrl(q) ? q : `ytsearch1:${q}`;
  const bin = config.ytdlpPath;
  const args = ["-J", ...ytdlpFormatArgs(), ...ytdlpCommonArgs(), "--skip-download", target];

  let stdout: string;
  try {
    const result = await execFileAsync(bin, args, {
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
      timeout: 60_000,
    });
    stdout = result.stdout;
  } catch (err: any) {
    const detail = String(err?.stderr || err?.message || err).slice(0, 400);
    if (/not found|ENOENT/i.test(detail) || err?.code === "ENOENT") {
      throw new UserError(
        `yt-dlp is not available ("${bin}"). Install yt-dlp and put it on PATH, or set YTDLP_PATH in .env.`,
      );
    }
    throw new UserError(`Couldn't resolve that track: ${detail || "yt-dlp failed."}`);
  }

  let info: any;
  try {
    info = JSON.parse(stdout);
  } catch {
    throw new UserError("yt-dlp returned unreadable data for that query.");
  }

  const entry = pickEntry(info);
  if (!entry) throw new UserError("No results for that query.");

  const title = String(entry.title || entry.fulltitle || q);
  const pageUrl = String(entry.webpage_url || entry.original_url || (isHttpUrl(q) ? q : entry.url) || q);
  const durationSec =
    typeof entry.duration === "number" && Number.isFinite(entry.duration) ? Math.round(entry.duration) : null;

  return { title, pageUrl, durationSec };
}
