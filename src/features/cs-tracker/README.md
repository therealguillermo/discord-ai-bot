# CS Tracker

Discord → many Steam account links, plus multi-provider player dossiers for the agent.

## Tools

| Tool | Role |
| --- | --- |
| `cs_link_steam` / `cs_unlink_steam` / `cs_list_links` / `cs_set_primary` | Manage links (`data/cs-links.json`) |
| `cs_player` | Parallel fetch + merge → organized dossier |
| `cs_compare` | Side-by-side for 2–5 targets |
| `cs_search` / `cs_refresh` | CSRep search / refresh |
| `cs_leaderboard` | CSTracker leaderboards (best-effort HTML) |

## Providers

- **CSRep** (`CSREP_API_KEY`) — JSON API
- **CSST.at** (`CSST_ENABLED`, optional `CSST_API_KEY`) — HTMX fragments
- **CSTracker.gg** (`CSTRACKER_ENABLED`) — profile + leaderboards
- **FACEIT** / **Steam Web API** — optional official enrichers

The agent formats Discord replies from the dossier; it should not invent stats.
