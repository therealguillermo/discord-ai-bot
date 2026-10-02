---
name: music
description: >-
  Voice music playback and queue control via dedicated music_* tools (join, play,
  skip, move, clear, leave). Playback is deterministic code — not Discord REST.
---

# Music skill

## How to use this skill

1. Call the `music_*` tools directly. Do **not** use `discord_call` for playback.
2. The requester must be in a voice channel for join/play (tools error if not).
3. Pass URLs and search text **exactly** as the requester said them.
4. Queue positions are **1-based** and refer to the **upcoming** queue (not the song currently playing). Call `music_queue` before move/remove when unclear.
5. After play/skip/move, reply in one short line. Do not invent now-playing state — use tool results.
6. Needs host binaries: `yt-dlp` and `ffmpeg` (or `YTDLP_PATH` / `FFMPEG_PATH` in env).

---

## join

**keywords:** join, join voice, come to vc, hop in

**prefer tool:** `music_join`

```
music_join({})
```

Joins the requester's current voice channel with no track. Prefer `music_play` when they also named a song.

---

## leave / disconnect

**keywords:** leave, disconnect, get out, stop and leave

**prefer tool:** `music_leave`

```
music_leave({})
```

Leaves voice and clears the queue.

---

## play / start music

**keywords:** play, play song, put on, start playing, youtube

**prefer tool:** `music_play`

```
music_play({ query: "<url or search text>" })
```

Joins if needed. Starts immediately if idle; otherwise queues. Use when they want something to play now (or "join and play X").

**example:** "join and play never gonna give you up" → `music_play({ query: "never gonna give you up" })`

---

## add to queue

**keywords:** add, queue this, add to queue, put in queue

**prefer tool:** `music_add`

```
music_add({ query: "<url or search text>" })
```

Enqueues without skipping the current track. Starts playback if nothing is playing.

---

## skip / next

**keywords:** skip, next, next song

**prefer tool:** `music_skip`

```
music_skip({})
```

---

## stop

**keywords:** stop, stop music, halt

**prefer tool:** `music_stop`

```
music_stop({})
```

Stops the current track, clears the queue, **stays** in the voice channel. For leave, use `music_leave`.

---

## clear queue

**keywords:** clear queue, empty queue, wipe queue

**prefer tool:** `music_clear`

```
music_clear({ keep_current?: true })
```

Default `keep_current=true` clears upcoming songs only. Set `keep_current=false` to also stop the current song.

---

## show queue / now playing

**keywords:** queue, what's playing, now playing, list songs

**prefer tool:** `music_queue`

```
music_queue({})
```

Returns connection state, current track, and numbered upcoming tracks.

---

## move queue / to front

**keywords:** move, reorder, to front, play next, bump

**prefer tool:** `music_move`

```
music_move({ from_index: <1-based>, to_index: <1-based> })
```

"Move song 3 to the front" → `music_move({ from_index: 3, to_index: 1 })`.

If they name a song, call `music_queue` first, match the title, then move.

---

## remove from queue

**keywords:** remove, delete from queue, take out

**prefer tool:** `music_remove`

```
music_remove({ index: <1-based> })
```

---

## pause / resume

**keywords:** pause, resume, unpause

**prefer tools:** `music_pause` / `music_resume`

```
music_pause({})
music_resume({})
```

---

## Quick decision table

| User says | Tool |
| --- | --- |
| join (no song) | `music_join` |
| join and play X / play X | `music_play` |
| add X to queue | `music_add` |
| skip / next | `music_skip` |
| stop (stay in VC) | `music_stop` |
| leave | `music_leave` |
| clear queue | `music_clear` |
| what's playing / show queue | `music_queue` |
| move 3 to front | `music_move` from=3 to=1 |
| pause / resume | `music_pause` / `music_resume` |
