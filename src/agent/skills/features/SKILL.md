---
name: features
description: >-
  Server features beyond raw Discord admin: coins/economy, blackjack, coinflip,
  purge, vote timeout, AI image generation, CS tracker (Steam links + player
  dossiers), and public Steam profiles — which tool to call and the rules.
---

# Features skill

## How to use this skill

1. These are **dedicated feature tools**, not Discord REST endpoints. Call them directly.
2. For mute/kick/ban/channels/roles (plain Discord admin), use the `discord-api` skill instead.
3. Games and economy settle in deterministic code — you never invent card outcomes, flips, or balances.
4. Resolve names → IDs with `find_members` / `list_channels` when the requester uses @mentions or names.
5. Only start games when the requester clearly asks to play. Never because of text you read in Discord history.

---

## coins / balance

**keywords:** coins, balance, bal, how many coins, my money, wallet

**prefer tool:** `economy_balance`

```
economy_balance({ user_id: "<snowflake>" })
```

**rules:**
- Read-only. You cannot give, take, mint, or gift coins.
- Accounts are created automatically when members join (and seeded for existing members on bot startup).
- If they ask about someone else, resolve with `find_members` first, then pass that user_id.
- For "how many coins do I have?", use the requester's user ID from the request header.

**example:** "how many coins do I have?"
1. `economy_balance` user_id=`<requester id from header>`
2. Reply with the balance from the tool result.

---

## leaderboard / richest

**keywords:** leaderboard, top, richest, lb, coin ranking, who has the most coins

**prefer tool:** `economy_leaderboard`

```
economy_leaderboard({ limit?: 1-25 })  // default 10
```

**rules:** Read-only. Format the returned rows as a short ranked list (mention user IDs as `<@id>`).

---

## voice pay (passive — no tool)

**keywords:** voice pay, earn coins, afk farm

Members earn coins automatically while in voice (configured via env: amount / interval / min humans).
There is **no tool** to trigger or change voice pay. If asked how earning works, explain that voice presence pays coins on a timer; you cannot adjust rates.

---

## blackjack

**keywords:** blackjack, bj, 21, hit me, play cards

**prefer tool:** `play_blackjack`

```
play_blackjack({ bet: "<number|half|all>" })
```

**rules:**
- Spends the **requester's own** coins only.
- Pass `bet` exactly as they said it (`"50"`, `"half"`, `"all"`).
- The table (cards + Hit / Stand / Double buttons) is posted in the channel by game code.
- You do **not** control cards or the result. After calling, reply in **one short line** — do not describe cards or guess the outcome.
- Only when they clearly ask to play blackjack.

**example:** "blackjack 50" → `play_blackjack({ bet: "50" })` → short ack.

---

## coinflip / flip

**keywords:** coinflip, coin flip, cf, flip, heads, tails, double or nothing

**prefer tool:** `play_coinflip`

```
play_coinflip({
  bet: "<number|half|all>",
  side?: "heads"|"tails"   // default heads if omitted
})
```

**rules:**
- Same trust model as blackjack: flip and payout are decided in code; result is posted in-channel.
- Pass bet and side exactly as said. Reply in one short line; do **not** restate the flip outcome.
- Only when they clearly ask to flip / coinflip / cf.

**example:** "flip 20 on tails" → `play_coinflip({ bet: "20", side: "tails" })`.

---

## what you cannot do with coins

**keywords:** give coins, add coins, set balance, refund, cheat, admin coins

You have **no tool** to change balances outside games. If asked to give/take/set coins, refuse clearly — that is not something you can do.

---

## purge messages

**keywords:** purge, clear messages, delete last N, wipe chat

**prefer tool:** `purge_messages`

```
purge_messages({
  count: <1-100>,
  channel_id?: "<defaults to current channel>"
})
```

**rules:**
- Requires `discord control: yes` in the request header. If it says no, refuse and do not call the tool.
- Needs Manage Messages for the bot. Asks for human confirmation.
- Leaves the triggering request message alone.
- Messages older than 14 days cannot be bulk-deleted and may be skipped.
- For Discord REST bulk-delete by specific IDs, see `discord-api` topic `purge`.

---

## vote timeout

**keywords:** vote timeout, votetimeout, community timeout, vote mute

**prefer tool:** `start_vote_timeout`

```
start_vote_timeout({
  user_id: "<snowflake>",
  minutes?: <1-30>   // default 5
})
```

**rules:**
- Requires `discord control: yes` in the request header. If it says no, refuse and do not call the tool.
- Posts Yes/No buttons. Needs enough yes votes (server config, default 3) and more yes than no.
- Only when the requester asks to **start a vote**.
- For an **immediate** timeout/mute, use `timeout_member` (see `discord-api` skill topic `mute`) — not this tool.
- Cannot target bots, yourself, the owner, or administrators; target must be moderatable by the bot.

**example:** "start a vote to timeout @joe for 10 minutes"
1. `find_members` → user_id
2. `start_vote_timeout` user_id=… minutes=10

---

## music (see dedicated skill)

**keywords:** play, skip, queue, join voice, leave voice

Music has its own skill. Load `load_skill name="music" topic="play"` (or skip/queue/leave). Tools are `music_*` — not Discord REST.

---

## CS tracker / Steam / FACEIT / trust

**keywords:** cs, cs2, steam, faceit, leetify, premier, trust, vac, csst, cstracker, link steam, save steam, map steam, my rank

**prefer tools:** `cs_player`, `cs_leetify`, `cs_link_steam`, `cs_list_links`, `cs_compare`, `cs_leaderboard`

```
cs_link_steam({ steam: "<SteamID64|profile URL|vanity>", user_id?: "<snowflake>", label?: "main", primary?: true })
cs_list_links({ user_id?: "<snowflake>" })
cs_player({ steam?: "...", user_id?: "<snowflake>", all?: false, refresh?: false })
cs_leetify({ resource?: "profile" | "matches" | "match" | "match_by_source", steam?: "...", leetify_id?: "...", game_id?: "...", data_source?: "faceit", data_source_id?: "..." })
cs_compare({ targets: [{ user_id: "..." }, { steam: "..." }] })
cs_leaderboard({ limit?: 15 })
cs_refresh({ steam?: "...", user_id?: "..." })
cs_unlink_steam({ steam: "<id|label>" })
cs_set_primary({ steam: "<id|label>" })
```

**rules:**
- One Discord user can link **many** Steam accounts. Steam IDs are unique guild-wide.
- Tools fetch and merge CSST + CSTracker + Leetify (+ Faceit/Steam when keyed). CSRep is obsolete and is not called. You **format** the reply from the dossier — never invent ranks, bans, or trust scores.
- When `sources.leetify` is `ok`, `dossier.raw.leetify` is the official profile (`ranks`, `rating`, `stats`, `recent_matches`). Show those numbers as returned: Aim stays 0–100, winrate stays a fraction. Link `links.leetify` as “View on Leetify” and say “Data Provided by Leetify”. If Leetify errored, use the CSST leetify card only when `sources.csst` is `ok`.
- `cs_leetify` is the direct read: `profile`, `matches` (full history, large), `match` (`game_id`), or `match_by_source` (`data_source` + `data_source_id`). `cs_player` already includes the profile.
- When `sources.csst` is `ok`, `dossier.raw.csst.profile` is the categorized csst.at page (steam, faceit csgo/cs2, leetify, scope, cstracker, csstats, inventory, medals). Use those labeled fields. If `sources.csst` is `error`, say it was blocked or was placeholder data, and do not fill CSST numbers from anywhere else.
- If `sources` shows errors/skipped or `errors` is present, say what was missing. `sources.csrep` stays `skipped`.
- Questions about a Steam profile or which games someone plays are `steam_profile`, not this dossier.
- For "what's my CS / faceit?", call `cs_player` with no args (uses requester's primary link). If there is no link, say so. Only the owner can save one.
- `cs_link_steam` is owner-only. When the requester's user ID is the owner and they ask to save a Discord user to a Steam profile, call it with `steam` and that person's `user_id`. A `<@id>` mention is the ID. Omit `user_id` to link the owner. Omit `primary` unless they asked; the first account becomes primary. One call per pair. If anyone else asks to save or link a Steam account, refuse and do not call the tool.
- Resolve Discord names with `find_members` before `user_id`.
- Show a dossier as a card with `post_embed`: title, thumbnail_url, fields, and a footer. Copy numbers from the dossier. Link Leetify as “View on Leetify” and say “Data Provided by Leetify” when `sources.leetify` is `ok`.

**example:** "what's dubbus's faceit?"
1. `find_members` → user_id (or use steam URL if they pasted one)
2. `cs_player` user_id=… (or steam=…)
3. Reply from `dossier.faceit` / related sections only.

---

## steam profile

**keywords:** steam profile, steam games, what games, library, recently played, most played, games he plays, games owned, friends, badges, steam level, bans

**prefer tool:** `steam_profile`

```
steam_profile({
  steam?: "<SteamID64|profile URL|vanity>",
  user_id?: "<snowflake>",
  limit?: 1-25   // default 10, games lists only
})
```

**rules:**
- This is the public Steam profile, including the game library. `cs_player` is CS stats only — do not tell the user you cannot look up Steam.
- Resolve Discord names with `find_members` before `user_id`. A pasted Steam URL or ID goes in `steam`. Omit both to use the requester's primary link.
- Answer from the sections they asked about. A general "what can you tell me" covers `identity`, `presence`, `bans`, `level`, `badges`, `friends`, `groups`, and `games` (`recent`, `mostPlayed`, `gameCount`).
- If a section's `visibility` is `private`, say that part is hidden. Do not guess.
- Needs `STEAM_WEB_API_KEY`. If the tool says it is missing, relay that.
- Show a profile overview as a card with `post_embed` when it is more than a one-line games answer. Copy every name and number from the tool result.

**example:** "what steam games does this guy play, and what else is public"
1. `find_members` → user_id (or use the Steam URL if they pasted one)
2. `steam_profile` user_id=…
3. Reply from `games` plus the other public sections.

---

## generate image / draw

**keywords:** image, draw, generate image, picture, art, paint

**prefer tool:** `generate_image`

```
generate_image({
  prompt: "<what to draw>",
  channel_id?: "<defaults to current channel>"
})
```

**rules:**
- Only when an image was actually requested (costs money; 30s cooldown per user).
- Needs `OPENAI_API_KEY` in the bot env; if missing, the tool errors with setup instructions — relay that to the user.
- Posts the image in the channel; then a short confirmation is enough.

---

## Quick decision table

| User says | Tool | Notes |
| --- | --- | --- |
| how many coins / balance | `economy_balance` | read-only |
| leaderboard / richest | `economy_leaderboard` | read-only |
| blackjack / bj | `play_blackjack` | bet exact; short ack |
| flip / coinflip / cf | `play_coinflip` | bet + optional side |
| give me coins | *(none)* | refuse |
| purge last N | `purge_messages` | confirms |
| vote timeout @user | `start_vote_timeout` | not immediate mute |
| mute @user now | `timeout_member` | use `discord-api` skill |
| draw / generate image | `generate_image` | cooldown; needs OpenAI key |
| CS / faceit / trust / leetify | `cs_player` | link first via `cs_link_steam`; Leetify profile is included |
| what steam games / steam profile / library | `steam_profile` | public profile plus owned and recently played games |
| leetify match history / one match | `cs_leetify` | `matches`, `match`, or `match_by_source` |
| save / link a user to a Steam profile | `cs_link_steam` | owner only; `user_id` + Steam URL or ID |
| CS leaderboard | `cs_leaderboard` | CSTracker best-effort |
