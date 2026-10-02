# Music feature — what worked / what didn’t

Agent-controlled voice playback: deterministic `MusicPlayer` + queue, exposed as `music_*` tools, with the `music` skill for intent mapping.

## Architecture (what we kept)

| Piece | Role |
| --- | --- |
| [`queue.ts`](queue.ts) | In-memory upcoming tracks (1-based move/remove) |
| [`player.ts`](player.ts) | Join VC, pipe audio, skip/stop/clear/pause |
| [`resolve.ts`](resolve.ts) | Metadata via `yt-dlp -J` (title, page URL, duration) |
| [`ytdlp.ts`](ytdlp.ts) | Shared yt-dlp flags / YouTube client workarounds |
| [`index.ts`](index.ts) | Agent tools + feature lifecycle |
| Skill | [`../../agent/skills/music/SKILL.md`](../../agent/skills/music/SKILL.md) |

Playback path that works:

```text
yt-dlp (page URL → stdout) → ffmpeg (PCM s16le) → @discordjs/voice → Discord
```

Do **not** extract a googlevideo CDN URL and hand it to ffmpeg. That 403s.

## Host requirements

| Requirement | Notes |
| --- | --- |
| **Node ≥ 22.12** | Discord **DAVE** voice encryption. `npm start` (`scripts/run.mjs`) auto-picks Hermes Node 22 if the shell still has Node 18. |
| **`@discordjs/voice` 0.19 + `@snazzah/davey`** | Required for DAVE. 0.17/0.18 stuck in `signalling` ↔ `connecting`. |
| **`@discordjs/opus` (or `opusscript`)** | Needed to encode PCM for Discord. Rebuild natives after switching Node major: `npm run rebuild:native`. |
| **yt-dlp** (recent) | Keep updated: `yt-dlp -U`. |
| **ffmpeg** on PATH | Converts yt-dlp output to raw PCM. |
| Bot perms | **Connect** + **Speak** in the target voice channel. |
| Requester | Must already be in a voice channel. |

Optional `.env`:

```env
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
YTDLP_EXTRACTOR_ARGS=youtube:player_client=android,tv_embedded,visionos
YTDLP_COOKIES_FROM_BROWSER=chrome   # if anonymous YouTube keeps 403ing
NODE_BINARY=C:\path\to\node.exe     # force Node for npm start
```

---

## What failed (and why)

### Voice join stuck: `signalling` → `connecting` → timeout

- **Cause:** Old `@discordjs/voice` without DAVE; also joining via `guilds.fetch()` instead of the gateway-cached guild.
- **Fix:** Use cached guild + `voiceAdapterCreator`; upgrade to voice **0.19** + **`@snazzah/davey`**; run on **Node 22+**.

### Agent said “missing opus” / playback silent after Ready

- **Cause:** `@discordjs/opus` native binary was built for Node 18; under Node 22 the `.node` ABI path was missing. Dependency report can still say “opus: 0.10.0” even when require fails.
- **Fix:** `npm rebuild @discordjs/opus` under Node 22; install **`opusscript`** fallback; `run.mjs` rebuilds natives when needed.

### `ffmpeg: Server returned 403 Forbidden` on googlevideo URLs

- **Cause:** Resolve stream URL with yt-dlp, then open that URL in ffmpeg. YouTube rejects the second hop.
- **Fix:** Pipe **`yt-dlp -o -` → ffmpeg stdin** using the **page URL**, never the CDN URL alone.

### `yt-dlp: HTTP Error 403` / SABR-only formats

- **Cause:** YouTube experiment; default player clients return unusable/SABR formats.
- **Fix (worked here):**
  - Update yt-dlp (`yt-dlp -U` — we landed on **2026.08.19**).
  - Force clients: `youtube:player_client=android,tv_embedded,visionos` (see `YTDLP_EXTRACTOR_ARGS`).
- **Client experiments (local):**

  | Client | Result |
  | --- | --- |
  | default (no override) | 403 / unusable |
  | `android` | Worked (e.g. progressive format 18) |
  | `tv_embedded` / `visionos` | Worked (e.g. 251 / m3u8) |
  | `ios`, `web_embedded`, `mweb`, `tv` | Failed / needed PO tokens / JS challenge |

- **If it breaks again:** bump yt-dlp; try `YTDLP_COOKIES_FROM_BROWSER=chrome`; check [yt-dlp YouTube issues](https://github.com/yt-dlp/yt-dlp/issues).

### Agent inventing wrong errors

- The model sometimes blamed “missing opus” when the tool actually returned a YouTube 403.
- Prefer reading `[music]` lines in the bot terminal; tools now wait for audio bytes before reporting success.

---

## What worked (checklist)

1. Node 22 via `npm start` / Hermes auto-select  
2. Voice Ready with DAVE (`@discordjs/voice@0.19` + davey)  
3. Opus encode after rebuild / opusscript  
4. Join requester’s VC from **cached** guild  
5. `music_play` / queue / skip via agent tools  
6. yt-dlp stdout → ffmpeg PCM → Discord  
7. YouTube clients `android,tv_embedded,visionos` after yt-dlp update  

---

## Quick test

```powershell
npm start
```

In Discord (you in a VC first):

```text
@Bot play never gonna give you up
@Bot what's in the queue
@Bot skip
@Bot leave
```

Expect terminal: `[music] voice … -> ready` and no ffmpeg/yt-dlp 403s.
