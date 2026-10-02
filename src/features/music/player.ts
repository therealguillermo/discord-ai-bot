import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  type AudioPlayer,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from "@discordjs/voice";
import { PermissionFlagsBits, type Client, type VoiceBasedChannel } from "discord.js";
import { config } from "../../config.js";
import { UserError } from "../types.js";
import { MusicQueue, type Track } from "./queue.js";
import { resolveQuery } from "./resolve.js";
import { ytdlpCommonArgs, ytdlpFormatArgs } from "./ytdlp.js";

export class MusicPlayer {
  private client: Client | null = null;
  private readonly queue = new MusicQueue();
  private player: AudioPlayer | null = null;
  private connection: VoiceConnection | null = null;
  private current: Track | null = null;
  private ytdlp: ChildProcess | null = null;
  private ffmpeg: ChildProcess | null = null;
  private starting = false;
  private destroyed = false;

  bind(client: Client): void {
    this.client = client;
  }

  status() {
    return {
      connected: Boolean(this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed),
      channelId: this.connection?.joinConfig.channelId ?? null,
      playing: this.player?.state.status === AudioPlayerStatus.Playing,
      paused: this.player?.state.status === AudioPlayerStatus.Paused,
      current: this.current
        ? {
            title: this.current.title,
            page_url: this.current.pageUrl,
            duration_sec: this.current.durationSec,
            requested_by: this.current.requestedBy,
          }
        : null,
      queue: this.queue.list().map((t, i) => ({
        position: i + 1,
        title: t.title,
        page_url: t.pageUrl,
        duration_sec: t.durationSec,
        requested_by: t.requestedBy,
      })),
      queue_length: this.queue.length,
    };
  }

  private ensurePlayer(): AudioPlayer {
    if (this.player) return this.player;
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    player.on(AudioPlayerStatus.Idle, () => {
      void this.onTrackEnded();
    });
    player.on("error", (err) => {
      console.error("[music] audio player error:", err);
      void this.onTrackEnded();
    });
    this.player = player;
    return player;
  }

  private stopPipeline(): void {
    for (const proc of [this.ffmpeg, this.ytdlp]) {
      if (!proc) continue;
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    this.ffmpeg = null;
    this.ytdlp = null;
  }

  private async onTrackEnded(): Promise<void> {
    if (this.destroyed || this.starting) return;
    this.stopPipeline();
    this.current = null;
    await this.playNext();
  }

  /** Must use the gateway-cached guild — fetch()'d guilds break the voice adapter. */
  private cachedGuild() {
    if (!this.client) throw new UserError("Music player is not ready yet.");
    const guild = this.client.guilds.cache.get(config.guildId);
    if (!guild) throw new UserError("I'm not connected to the configured server yet.");
    return guild;
  }

  private async requesterVoiceChannel(requesterId: string): Promise<VoiceBasedChannel> {
    const guild = this.cachedGuild();
    const member = await guild.members.fetch(requesterId).catch(() => null);
    const voiceChannelId = member?.voice.channelId;
    if (!voiceChannelId) {
      throw new UserError("Join a voice channel first, then ask me again.");
    }
    const channel = guild.channels.cache.get(voiceChannelId);
    if (!channel || !channel.isVoiceBased()) {
      throw new UserError("Join a voice channel first, then ask me again.");
    }
    return channel;
  }

  async join(requesterId: string): Promise<{ channel_id: string; channel_name: string }> {
    const channel = await this.requesterVoiceChannel(requesterId);
    await this.connect(channel);
    return { channel_id: channel.id, channel_name: channel.name };
  }

  private async connect(channel: VoiceBasedChannel): Promise<VoiceConnection> {
    const guild = this.cachedGuild();
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (me) {
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.Connect)) {
        throw new UserError(`I don't have Connect permission in <#${channel.id}>.`);
      }
      if (!perms.has(PermissionFlagsBits.Speak)) {
        throw new UserError(`I don't have Speak permission in <#${channel.id}>.`);
      }
    }

    const existing = getVoiceConnection(config.guildId);
    if (existing && existing.joinConfig.channelId === channel.id) {
      this.connection = existing;
      existing.subscribe(this.ensurePlayer());
      return existing;
    }
    if (existing) {
      existing.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: true,
    });
    connection.on("error", (err) => console.error("[music] voice connection error:", err));
    connection.on("stateChange", (oldState, newState) => {
      if (oldState.status !== newState.status) {
        console.log(`[music] voice ${oldState.status} -> ${newState.status}`);
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
      const status = connection.state.status;
      console.error(`[music] join failed (status=${status}):`, err);
      connection.destroy();
      this.connection = null;
      throw new UserError(
        `Couldn't join voice (stuck at ${status}). Confirm I'm allowed Connect/Speak in that channel, then try again.`,
      );
    }

    connection.subscribe(this.ensurePlayer());
    this.connection = connection;
    return connection;
  }

  async leave(): Promise<{ left: boolean; cleared: number }> {
    const cleared = this.queue.clear();
    this.stopPipeline();
    this.current = null;
    this.player?.stop(true);
    const conn = this.connection ?? getVoiceConnection(config.guildId);
    if (conn) {
      conn.destroy();
      this.connection = null;
      return { left: true, cleared };
    }
    return { left: false, cleared };
  }

  private async resolveTrack(query: string, requestedBy: string): Promise<Track> {
    const media = await resolveQuery(query);
    return {
      id: randomUUID(),
      title: media.title,
      pageUrl: media.pageUrl,
      durationSec: media.durationSec,
      requestedBy,
    };
  }

  async play(requesterId: string, query: string): Promise<{
    action: "started" | "queued";
    track: ReturnType<MusicPlayer["status"]>["current"];
    position: number | null;
    status: ReturnType<MusicPlayer["status"]>;
  }> {
    const channel = await this.requesterVoiceChannel(requesterId);
    await this.connect(channel);
    const track = await this.resolveTrack(query, requesterId);
    const wasIdle =
      !this.current &&
      this.player?.state.status !== AudioPlayerStatus.Playing &&
      this.player?.state.status !== AudioPlayerStatus.Paused;

    const position = this.queue.enqueue(track);
    if (wasIdle) {
      await this.playNext();
      return {
        action: "started",
        track: this.status().current,
        position: null,
        status: this.status(),
      };
    }

    return {
      action: "queued",
      track: {
        title: track.title,
        page_url: track.pageUrl,
        duration_sec: track.durationSec,
        requested_by: track.requestedBy,
      },
      position,
      status: this.status(),
    };
  }

  async add(requesterId: string, query: string): Promise<{
    track: { title: string; page_url: string; duration_sec: number | null; requested_by: string };
    position: number;
    status: ReturnType<MusicPlayer["status"]>;
  }> {
    // Allow add without being connected only if already connected; else join first.
    if (!this.connection || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
      await this.join(requesterId);
    }
    const track = await this.resolveTrack(query, requesterId);
    const wasIdle =
      !this.current &&
      this.player?.state.status !== AudioPlayerStatus.Playing &&
      this.player?.state.status !== AudioPlayerStatus.Paused;
    const position = this.queue.enqueue(track);
    if (wasIdle) await this.playNext();
    return {
      track: {
        title: track.title,
        page_url: track.pageUrl,
        duration_sec: track.durationSec,
        requested_by: track.requestedBy,
      },
      position,
      status: this.status(),
    };
  }

  /**
   * Stream via yt-dlp → ffmpeg → Discord.
   * Do NOT pass googlevideo CDN URLs to ffmpeg directly (YouTube returns 403).
   */
  private async playNext(): Promise<void> {
    if (this.destroyed) return;
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      return;
    }
    if (!this.connection || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
      this.queue.enqueue(next);
      throw new UserError("Not connected to a voice channel.");
    }

    this.starting = true;
    try {
      let track = next;
      try {
        const fresh = await resolveQuery(next.pageUrl);
        track = { ...next, title: fresh.title || next.title, pageUrl: fresh.pageUrl || next.pageUrl, durationSec: fresh.durationSec };
      } catch {
        track = next;
      }

      this.stopPipeline();

      const ytdlp = spawn(
        config.ytdlpPath,
        [...ytdlpFormatArgs(), "-o", "-", "--quiet", ...ytdlpCommonArgs(), track.pageUrl],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      this.ytdlp = ytdlp;

      const ff = spawn(
        config.ffmpegPath,
        [
          "-i",
          "pipe:0",
          "-analyzeduration",
          "0",
          "-loglevel",
          "error",
          "-f",
          "s16le",
          "-ar",
          "48000",
          "-ac",
          "2",
          "pipe:1",
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.ffmpeg = ff;

      if (!ytdlp.stdout || !ff.stdin || !ff.stdout) {
        this.stopPipeline();
        throw new UserError("Failed to start the audio pipeline (yt-dlp/ffmpeg).");
      }

      ytdlp.stdout.pipe(ff.stdin);

      let errText = "";
      const onErr = (label: string) => (chunk: Buffer) => {
        const msg = String(chunk).trim();
        if (!msg) return;
        errText = `${errText}\n${msg}`.slice(-800);
        console.error(`[music] ${label}:`, msg.slice(0, 300));
      };
      ytdlp.stderr?.on("data", onErr("yt-dlp"));
      ff.stderr?.on("data", onErr("ffmpeg"));

      ytdlp.on("error", (err) => {
        console.error("[music] yt-dlp spawn error:", err);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          console.error(`[music] yt-dlp not found at "${config.ytdlpPath}". Set YTDLP_PATH or install yt-dlp.`);
        }
      });
      ff.on("error", (err) => {
        console.error("[music] ffmpeg spawn error:", err);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          console.error(`[music] FFmpeg not found at "${config.ffmpegPath}". Set FFMPEG_PATH or install ffmpeg.`);
        }
      });

      // Bridge so waiting for the first audio bytes doesn't drop them.
      const audio = new PassThrough();
      ff.stdout.pipe(audio);

      // Wait until audio bytes flow (or fail) so the agent gets a real error instead of a fake "playing".
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(
            new UserError(
              "Timed out starting audio. YouTube may be blocking this host — update yt-dlp (`yt-dlp -U`) and try a different track.",
            ),
          );
        }, 45_000);

        const cleanup = () => {
          clearTimeout(timer);
          audio.off("data", onData);
          ytdlp.off("close", onYtdlpClose);
          ff.off("close", onFfClose);
        };

        const fail = (msg: string) => {
          cleanup();
          this.stopPipeline();
          reject(new UserError(msg));
        };

        const onData = (chunk: Buffer) => {
          audio.unshift(chunk);
          cleanup();
          resolve();
        };

        const onYtdlpClose = (code: number | null) => {
          if (code && code !== 0) {
            const hint = /403|forbidden|sign in|blocked/i.test(errText)
              ? "YouTube blocked the download (403). Update yt-dlp (`yt-dlp -U`) and try again."
              : `yt-dlp exited with code ${code}. ${errText.slice(0, 200)}`;
            fail(hint);
          }
        };

        const onFfClose = (code: number | null) => {
          if (code && code !== 0) {
            fail(`ffmpeg failed while starting the track. ${errText.slice(0, 200)}`);
          }
        };

        audio.once("data", onData);
        ytdlp.once("close", onYtdlpClose);
        ff.once("close", onFfClose);
      });

      const resource = createAudioResource(audio, { inputType: StreamType.Raw });
      this.current = track;
      this.ensurePlayer().play(resource);
    } catch (err) {
      this.stopPipeline();
      this.current = null;
      throw err;
    } finally {
      this.starting = false;
    }
  }

  async skip(): Promise<{ skipped: string | null; now: ReturnType<MusicPlayer["status"]> }> {
    const skipped = this.current?.title ?? null;
    if (!skipped && this.queue.length === 0) {
      throw new UserError("Nothing is playing and the queue is empty.");
    }
    this.stopPipeline();
    this.current = null;
    if (this.player && this.player.state.status !== AudioPlayerStatus.Idle) {
      this.player.stop(true);
    } else {
      await this.playNext();
    }
    await new Promise((r) => setTimeout(r, 75));
    return { skipped, now: this.status() };
  }

  async stop(): Promise<{ stopped: boolean; cleared: number; status: ReturnType<MusicPlayer["status"]> }> {
    const cleared = this.queue.clear();
    const had = Boolean(this.current);
    this.stopPipeline();
    this.current = null;
    this.player?.stop(true);
    return { stopped: had || cleared > 0, cleared, status: this.status() };
  }

  async clear(keepCurrent = true): Promise<{ cleared: number; status: ReturnType<MusicPlayer["status"]> }> {
    const cleared = this.queue.clear();
    if (!keepCurrent) {
      this.stopPipeline();
      this.current = null;
      this.player?.stop(true);
    }
    return { cleared, status: this.status() };
  }

  async move(from: number, to: number): Promise<{ moved: string; status: ReturnType<MusicPlayer["status"]> }> {
    try {
      const track = this.queue.move(from, to);
      return { moved: track.title, status: this.status() };
    } catch (err) {
      throw new UserError(err instanceof Error ? err.message : String(err));
    }
  }

  async moveToFront(index: number): Promise<{ moved: string; status: ReturnType<MusicPlayer["status"]> }> {
    try {
      const track = this.queue.moveToFront(index);
      return { moved: track.title, status: this.status() };
    } catch (err) {
      throw new UserError(err instanceof Error ? err.message : String(err));
    }
  }

  async remove(index: number): Promise<{ removed: string; status: ReturnType<MusicPlayer["status"]> }> {
    try {
      const track = this.queue.remove(index);
      return { removed: track.title, status: this.status() };
    } catch (err) {
      throw new UserError(err instanceof Error ? err.message : String(err));
    }
  }

  pause(): { paused: boolean } {
    if (!this.current) throw new UserError("Nothing is playing.");
    const ok = this.ensurePlayer().pause(true);
    if (!ok) throw new UserError("Couldn't pause.");
    return { paused: true };
  }

  resume(): { resumed: boolean } {
    if (!this.current) throw new UserError("Nothing is paused.");
    const ok = this.ensurePlayer().unpause();
    if (!ok) throw new UserError("Couldn't resume.");
    return { resumed: true };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.leave();
    this.player?.stop(true);
    this.player = null;
  }
}

/** One player for the configured guild. */
export const musicPlayer = new MusicPlayer();
