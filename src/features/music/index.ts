import type { Client } from "discord.js";
import type { ToolDefinition } from "../../tools/types.js";
import { UserError, type Feature } from "../types.js";
import { musicPlayer } from "./player.js";

function str(input: Record<string, unknown>, key: string, required = true): string {
  const v = input[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new UserError(`${key} is required.`);
    return "";
  }
  return String(v);
}

function int(input: Record<string, unknown>, key: string): number {
  const n = Number(input[key]);
  if (!Number.isInteger(n)) throw new UserError(`${key} must be a whole number.`);
  return n;
}

async function withMusicError<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw err;
  }
}

const musicJoin: ToolDefinition = {
  name: "music_join",
  description: "Join the requester's current voice channel (no track). They must already be in a voice channel.",
  input_schema: { type: "object", properties: {} },
  handler: async (_input, ctx) => withMusicError(() => musicPlayer.join(ctx.requesterId)),
};

const musicLeave: ToolDefinition = {
  name: "music_leave",
  description: "Leave the voice channel and clear the music queue.",
  input_schema: { type: "object", properties: {} },
  handler: async () => withMusicError(() => musicPlayer.leave()),
};

const musicPlay: ToolDefinition = {
  name: "music_play",
  description:
    "Join the requester's voice channel if needed, resolve a URL or search query with yt-dlp, and play it " +
    "(starts immediately if idle, otherwise queues). Pass the query/URL exactly as the requester said it.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "YouTube/URL or search text." },
    },
    required: ["query"],
  },
  handler: async (input, ctx) =>
    withMusicError(() => musicPlayer.play(ctx.requesterId, str(input, "query"))),
};

const musicAdd: ToolDefinition = {
  name: "music_add",
  description:
    "Add a URL or search query to the music queue without skipping the current track. Joins voice if not connected.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "YouTube/URL or search text." },
    },
    required: ["query"],
  },
  handler: async (input, ctx) =>
    withMusicError(() => musicPlayer.add(ctx.requesterId, str(input, "query"))),
};

const musicSkip: ToolDefinition = {
  name: "music_skip",
  description: "Skip the currently playing track and start the next queued song (if any).",
  input_schema: { type: "object", properties: {} },
  handler: async () => withMusicError(() => musicPlayer.skip()),
};

const musicStop: ToolDefinition = {
  name: "music_stop",
  description: "Stop playback and clear the queue, but stay in the voice channel.",
  input_schema: { type: "object", properties: {} },
  handler: async () => withMusicError(() => musicPlayer.stop()),
};

const musicClear: ToolDefinition = {
  name: "music_clear",
  description:
    "Clear the upcoming queue. By default keeps the current track playing; set keep_current=false to also stop it.",
  input_schema: {
    type: "object",
    properties: {
      keep_current: {
        type: "boolean",
        description: "Default true: only clear upcoming tracks. false also stops the current song.",
      },
    },
  },
  handler: async (input) => {
    const keep = input.keep_current === undefined ? true : Boolean(input.keep_current);
    return withMusicError(() => musicPlayer.clear(keep));
  },
};

const musicQueue: ToolDefinition = {
  name: "music_queue",
  description:
    "Show now-playing and the numbered queue (1-based positions). Use before music_move / music_remove when the " +
    "requester refers to a song by name or vaguely.",
  input_schema: { type: "object", properties: {} },
  handler: async () => musicPlayer.status(),
};

const musicMove: ToolDefinition = {
  name: "music_move",
  description:
    "Move a queued track from one 1-based position to another (queue only — not the current song). " +
    "To put a song at the front, set to_index=1. Call music_queue first if you need positions.",
  input_schema: {
    type: "object",
    properties: {
      from_index: { type: "integer", description: "Current 1-based queue position." },
      to_index: { type: "integer", description: "Destination 1-based queue position." },
    },
    required: ["from_index", "to_index"],
  },
  handler: async (input) =>
    withMusicError(() => musicPlayer.move(int(input, "from_index"), int(input, "to_index"))),
};

const musicRemove: ToolDefinition = {
  name: "music_remove",
  description: "Remove a track from the queue by 1-based position (does not skip the current song).",
  input_schema: {
    type: "object",
    properties: {
      index: { type: "integer", description: "1-based queue position." },
    },
    required: ["index"],
  },
  handler: async (input) => withMusicError(() => musicPlayer.remove(int(input, "index"))),
};

const musicPause: ToolDefinition = {
  name: "music_pause",
  description: "Pause the current track.",
  input_schema: { type: "object", properties: {} },
  handler: async () => withMusicError(() => musicPlayer.pause()),
};

const musicResume: ToolDefinition = {
  name: "music_resume",
  description: "Resume a paused track.",
  input_schema: { type: "object", properties: {} },
  handler: async () => withMusicError(() => musicPlayer.resume()),
};

export const musicFeature: Feature = {
  name: "Music",
  tools: [
    musicJoin,
    musicLeave,
    musicPlay,
    musicAdd,
    musicSkip,
    musicStop,
    musicClear,
    musicQueue,
    musicMove,
    musicRemove,
    musicPause,
    musicResume,
  ],
  start: async (client: Client<true>) => {
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 22) {
      console.warn(
        `[music] Node ${process.versions.node} is too old for Discord voice (need 22.12+ for DAVE). ` +
          `Joins will stall in "signalling". Switch to Node 22+ then restart.`,
      );
    }
    try {
      // Prefer native; fall back to pure-JS encoder.
      try {
        await import("@discordjs/opus");
      } catch {
        await import("opusscript");
        console.warn("[music] using opusscript fallback (native @discordjs/opus unavailable)");
      }
    } catch {
      console.error(
        "[music] no Opus encoder loaded — playback will fail. Run: npm run rebuild:native",
      );
    }
    musicPlayer.bind(client);
    console.log("[music] ready (yt-dlp + FFmpeg required on PATH or via YTDLP_PATH / FFMPEG_PATH)");
  },
  stop: async () => {
    await musicPlayer.destroy();
  },
};
