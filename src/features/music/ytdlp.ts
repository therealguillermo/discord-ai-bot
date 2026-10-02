import { config } from "../../config.js";

/**
 * Shared yt-dlp flags. YouTube currently 403s many default clients (SABR experiment);
 * android / tv_embedded / visionos still return plain downloadable formats.
 */
export function ytdlpCommonArgs(): string[] {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--extractor-args",
    config.ytdlpExtractorArgs,
  ];
  if (config.ytdlpCookiesFromBrowser) {
    args.push("--cookies-from-browser", config.ytdlpCookiesFromBrowser);
  }
  return args;
}

export function ytdlpFormatArgs(): string[] {
  return ["-f", config.ytdlpFormat];
}
