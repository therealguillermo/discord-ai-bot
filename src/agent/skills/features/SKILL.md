---
name: features
description: >-
  Server features beyond raw Discord admin: coins/economy, blackjack, coinflip,
  purge, vote timeout, and AI image generation — which tool to call and the rules.
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
- Posts Yes/No buttons. Needs enough yes votes (server config, default 3) and more yes than no.
- Only when the requester asks to **start a vote**.
- For an **immediate** timeout/mute, use `timeout_member` (see `discord-api` skill topic `mute`) — not this tool.
- Cannot target bots, yourself, the owner, or administrators; target must be moderatable by the bot.

**example:** "start a vote to timeout @joe for 10 minutes"
1. `find_members` → user_id
2. `start_vote_timeout` user_id=… minutes=10

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
