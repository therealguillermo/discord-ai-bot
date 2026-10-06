# CS Tracker

Discord → many Steam account links, plus multi-provider player dossiers for the agent.

## Tools

| Tool | Role |
| --- | --- |
| `cs_link_steam` / `cs_unlink_steam` / `cs_list_links` / `cs_set_primary` | Manage links (`data/cs-links.json`). Saving a link is owner-only. |
| `cs_player` | Parallel fetch + merge → organized dossier (includes Leetify profile) |
| `steam_profile` | Public Steam profile: identity, status, bans, level, badges, friends, groups, owned games, and last two weeks. Needs `STEAM_WEB_API_KEY`. Hidden sections stay hidden. |
| `cs_leetify` | Official Leetify profile, match history, or one match |
| `cs_compare` | Side-by-side for 2–5 targets |
| `cs_refresh` | Bypass the dossier cache and fetch again |
| `cs_leaderboard` | CSTracker leaderboards (best-effort HTML) |

## Providers

- **CSRep** — obsolete. The API is not available, so dossiers never call it. `sources.csrep` stays `skipped`. The parser in `providers/csrep.ts` is unused.
- **CSST.at** (`CSST_ENABLED`, optional `CSST_API_KEY`) — HTMX fragments `/{steamid}/steam|faceit|leetify|leetify-extra|scopegg|cstracker|csstatsgg|inventory|game-coordinator|links`, parsed into labeled fields on `dossier.raw.csst.profile`. Cloudflare challenges and placeholder pages are discarded.
- **CSTracker.gg** (`CSTRACKER_ENABLED`) — `/players/{steamid}`, same-origin `hx-get` sections on that page (including chat page 1 when the page lists it), and `/leaderboards`
- **Leetify** (`LEETIFY_ENABLED`, optional `LEETIFY_API_KEY`) — `GET /v3/profile`, `/v3/profile/matches`, `/v2/matches/{gameId}`, `/v2/matches/{dataSource}/{dataSourceId}` on `api-public.cs-prod.leetify.com`. Profile is merged into the dossier (`sources.leetify`, `dossier.raw.leetify`). The other three reads are `cs_leetify`. Metrics stay as returned. Replies should link the profile (“View on Leetify”) and say “Data Provided by Leetify”.
- **FACEIT** / **Steam Web API** — optional official enrichers

The agent formats Discord replies from the dossier; it should not invent stats.
