# CS Tracker

Discord → many Steam account links, plus multi-provider player dossiers for the agent.

## Tools

| Tool | Role |
| --- | --- |
| `cs_link_steam` / `cs_unlink_steam` / `cs_list_links` / `cs_set_primary` | Manage links (`data/cs-links.json`) |
| `cs_player` | Parallel fetch + merge → organized dossier |
| `cs_compare` | Side-by-side for 2–5 targets |
| `cs_search` / `cs_refresh` | CSRep search / refresh |
| `cs_match` / `cs_import_match` | CSRep match lookup and import (share code or FACEIT; no demo file upload) |
| `cs_leaderboard` | CSTracker leaderboards (best-effort HTML) |

## Providers

- **CSRep** (`CSREP_API_KEY`, header `X-API-Key`) — players (one, batch `?ids=`, search, refresh), matches (CSRep / FACEIT / Gamers Club ids), import by share code or FACEIT url/match id. Demo upload routes are not used.
- **CSST.at** (`CSST_ENABLED`, optional `CSST_API_KEY`) — HTMX fragments `/{steamid}/steam|faceit|leetify|leetify-extra|scopegg|cstracker|csstatsgg|inventory|game-coordinator|links`, parsed into labeled fields on `dossier.raw.csst.profile`. Cloudflare challenges and placeholder pages are discarded.
- **CSTracker.gg** (`CSTRACKER_ENABLED`) — `/players/{steamid}`, same-origin `hx-get` sections on that page (including chat page 1 when the page lists it), and `/leaderboards`
- **FACEIT** / **Steam Web API** — optional official enrichers

The agent formats Discord replies from the dossier; it should not invent stats.
