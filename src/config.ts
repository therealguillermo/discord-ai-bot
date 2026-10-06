import "dotenv/config";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{15,25}$/, "must be a Discord snowflake ID");

/** Comma-separated list of snowflake IDs; empty or missing means an empty list. */
const idList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .refine((ids) => ids.every((id) => /^\d{15,25}$/.test(id)), "must be comma-separated Discord IDs");

/** Optional string: unset or blank both become undefined. */
const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_APP_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  OWNER_USER_ID: snowflake,
  ALLOWED_USER_IDS: idList,
  ALLOWED_ROLE_IDS: idList,
  ALLOWED_CHANNEL_IDS: idList,
  MAX_AGENT_ITERATIONS: z.coerce.number().int().min(1).max(50).default(15),
  MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(64000).default(4096),
  HISTORY_WINDOW: z.coerce.number().int().min(2).max(100).default(20),
  MAX_TURN_TOKENS: z.coerce.number().int().min(10_000).default(300_000),

  // ---- Feature data (economy, games, moderation, images) ----
  DATA_DIR: z.string().min(1).default("data"),

  ECONOMY_STARTING_BALANCE: z.coerce.number().int().min(0).default(100),
  /** Coins paid to each eligible voice-chat member every interval. 0 disables voice pay. */
  VOICE_PAY_AMOUNT: z.coerce.number().int().min(0).default(10),
  VOICE_PAY_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(90),
  /** A voice channel must have at least this many humans for anyone in it to earn. */
  VOICE_PAY_MIN_HUMANS: z.coerce.number().int().min(1).default(2),

  VOTE_TIMEOUT_MIN_VOTES: z.coerce.number().int().min(2).default(3),

  OPENAI_API_KEY: optStr,
  IMAGE_MODEL: z.string().min(1).default("gpt-image-1"),

  /** yt-dlp binary name or absolute path (music feature). */
  YTDLP_PATH: z.string().min(1).default("yt-dlp"),
  /** FFmpeg binary name or absolute path (music feature). */
  FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  /**
   * YouTube extractor clients. Defaults avoid SABR/403-prone clients.
   * Override if yt-dlp docs recommend newer clients.
   */
  YTDLP_EXTRACTOR_ARGS: z
    .string()
    .min(1)
    .default("youtube:player_client=android,tv_embedded,visionos"),
  /** Format selector passed to yt-dlp `-f`. */
  YTDLP_FORMAT: z.string().min(1).default("bestaudio/best"),
  /**
   * Optional: pass browser cookies to yt-dlp, e.g. "chrome" or "firefox".
   * Helps when YouTube demands login / PO tokens. Leave unset for anonymous.
   */
  YTDLP_COOKIES_FROM_BROWSER: optStr,

  // ---- CS tracker (Discord ↔ Steam links + multi-provider dossiers) ----
  /** Unused. CSRep is obsolete and the live dossier path does not read this. */
  CSREP_API_KEY: optStr,
  FACEIT_API_KEY: optStr,
  LEETIFY_API_KEY: optStr,
  LEETIFY_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v.trim() === "" ? true : !/^(0|false|no|off)$/i.test(v.trim()))),
  STEAM_WEB_API_KEY: optStr,
  CSST_API_KEY: optStr,
  CSST_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v.trim() === "" ? true : !/^(0|false|no|off)$/i.test(v.trim()))),
  CSTRACKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null || v.trim() === "" ? true : !/^(0|false|no|off)$/i.test(v.trim()))),
  CS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(120),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    console.error(`Invalid environment configuration:\n${lines.join("\n")}`);
    console.error("Copy .env.example to .env and fill in the values.");
    process.exit(1);
  }
  const e = parsed.data;
  return {
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    model: e.ANTHROPIC_MODEL,
    discordToken: e.DISCORD_BOT_TOKEN,
    appId: e.DISCORD_APP_ID,
    guildId: e.DISCORD_GUILD_ID,
    ownerId: e.OWNER_USER_ID,
    allowedUserIds: e.ALLOWED_USER_IDS,
    allowedRoleIds: e.ALLOWED_ROLE_IDS,
    allowedChannelIds: e.ALLOWED_CHANNEL_IDS,
    maxIterations: e.MAX_AGENT_ITERATIONS,
    maxOutputTokens: e.MAX_OUTPUT_TOKENS,
    historyWindow: e.HISTORY_WINDOW,
    maxTurnTokens: e.MAX_TURN_TOKENS,

    dataDir: e.DATA_DIR,
    startingBalance: e.ECONOMY_STARTING_BALANCE,
    voicePayAmount: e.VOICE_PAY_AMOUNT,
    voicePayIntervalMs: e.VOICE_PAY_INTERVAL_SECONDS * 1000,
    voicePayMinHumans: e.VOICE_PAY_MIN_HUMANS,
    voteTimeoutMinVotes: e.VOTE_TIMEOUT_MIN_VOTES,
    openaiApiKey: e.OPENAI_API_KEY,
    imageModel: e.IMAGE_MODEL,
    ytdlpPath: e.YTDLP_PATH,
    ffmpegPath: e.FFMPEG_PATH,
    ytdlpExtractorArgs: e.YTDLP_EXTRACTOR_ARGS,
    ytdlpFormat: e.YTDLP_FORMAT,
    ytdlpCookiesFromBrowser: e.YTDLP_COOKIES_FROM_BROWSER,

    csrepApiKey: e.CSREP_API_KEY,
    faceitApiKey: e.FACEIT_API_KEY,
    leetifyApiKey: e.LEETIFY_API_KEY,
    leetifyEnabled: e.LEETIFY_ENABLED,
    steamWebApiKey: e.STEAM_WEB_API_KEY,
    csstApiKey: e.CSST_API_KEY,
    csstEnabled: e.CSST_ENABLED,
    cstrackerEnabled: e.CSTRACKER_ENABLED,
    csCacheTtlSeconds: e.CS_CACHE_TTL_SECONDS,
  };
}

export const config = load();
export type Config = typeof config;
