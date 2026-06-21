# Daily Briefing

A serverless news aggregator that pulls 14 sources every hour and serves them as a clean, keyboard-driven reader. Built to replace the time sink of scrolling Instagram or YouTube for "what's happening today."

**Live:** https://srikanthchandra174.github.io/daily-news/

---

## Why this exists

Most news apps are designed to keep you scrolling. This one is designed to get you in and out in 60 seconds: a single recency-sorted stream, topic filters, read-state tracking, save-for-later, and vim-style keyboard navigation. No ads, no infinite scroll, no algorithm.

It also exists as a small engineering exercise in solving a real problem the boring-correct way: the first version of this hit every classic browser-side dead end (CORS, flaky public proxies, ISP-level blocking), and the working architecture only emerged after I treated the failure data as a debugging problem, not a configuration problem.

## Architecture

```
                                  hourly cron
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │   GitHub Actions     │   server-side fetch
   14 RSS / JSON sources ──►│   (Ubuntu runner,    │── no CORS, no proxy
                            │    Node 22)          │   no ISP blocking
                            └──────────┬───────────┘
                                       │ writes news.json
                                       │ commits to repo
                                       ▼
                            ┌──────────────────────┐
                            │   GitHub Pages       │
                            │   (static hosting)   │
                            └──────────┬───────────┘
                                       │ serves index.html + news.json
                                       ▼
                            ┌──────────────────────┐
                            │   Browser            │   reads only own-origin
                            │   (vanilla JS, no    │   static files; CORS
                            │    deps, no build)   │   irrelevant
                            └──────────────────────┘
```

**Result:** zero servers to maintain, zero third-party services in the runtime path, zero recurring cost. Public repo → unlimited GitHub Actions minutes → free forever.

## Key engineering decisions

| Decision | Why |
|---|---|
| Fetch on GitHub's servers, not in the browser | News sites don't send CORS headers; browser-side `fetch` is therefore blocked. Public CORS proxies are unreliable and frequently blocked at the ISP level (verified with telemetry from the browser-only prototype). Moving the fetch server-side eliminates the entire class of failure. |
| GitHub Actions cron over a dedicated server | Hourly refresh doesn't justify a running process. A scheduled Action gives the same outcome with no server to maintain, monitor, or pay for. |
| Static `news.json` checked into the repo | The browser only reads same-origin static files. No backend, no API, no auth — and the file is browseable, diff-able, and version-controlled. |
| Zero runtime dependencies | The fetch script uses only Node's built-in `fetch` and a hand-rolled regex RSS/Atom parser. No npm install step in the workflow. Faster runs, no supply-chain surface. |
| Vanilla HTML/CSS/JS, no framework | The page is one ~14 KB file. Loads instantly on any device, including over 2G. No build pipeline to maintain. |
| `localStorage` for read-state and saves | Per-device, no account system needed. Degrades gracefully if storage is blocked. |

## Features

- **14 sources across 6 topics** — AI/Tech, Jobs, India, World, Business, Movies
- **Hourly auto-refresh** via GitHub Actions cron
- **Keyboard navigation** — `j`/`k` to move, `o` to open, `s` to save, `h` to hide read, `r` to refresh, `/` to filter
- **Read-state tracking** — opened items dim automatically; toggle to hide them entirely
- **Saved articles** — star anything; persists per-device
- **NEW badges** on articles published since the last visit
- **Light / dark theme** — respects system preference
- **No tracking, no analytics, no ads** — none of these would be impossible to add, and they're absent by choice

## Tech stack

| Layer | Technology |
|---|---|
| Data pipeline | Node 22 on GitHub Actions (Ubuntu runner) |
| Scheduling | GitHub Actions cron (`0 * * * *`) |
| Storage | Static JSON in Git, served by GitHub Pages |
| Frontend | Vanilla HTML, CSS, JavaScript — no framework, no build |
| Hosting | GitHub Pages (free tier) |
| RSS/Atom parsing | Hand-rolled regex parser (no dependencies) |
| Persistence | Browser `localStorage` |

## Repository layout

```
.
├── index.html                  # The reader (single-file SPA, ~14 KB)
├── news.json                   # Latest aggregated feed; rewritten hourly by the Action
├── scripts/
│   └── fetch-news.mjs          # Node script: fetches sources, parses, dedupes, sorts
└── .github/
    └── workflows/
        └── fetch-news.yml      # GitHub Actions: cron schedule + push trigger
```

## Adding or changing sources

Edit `scripts/fetch-news.mjs` and commit. The push automatically triggers a fresh fetch — no deploy step needed.

```js
// For RSS feeds, add to the FEEDS array:
{ name:'Reuters World', topic:'world', url:'https://...' }

// For JSON APIs, add to SOURCES with a custom adapter function.
```

## What I'd do differently / next

Honest about the limits and the next iteration:

- **Schedule precision.** GitHub's free cron is best-effort and drifts 5–15 minutes. For hourly news this is invisible; for anything time-critical, a self-hosted runner or a real cron host is the upgrade.
- **No deduplication across sources.** A single story covered by both BBC and Guardian appears twice. Adding fuzzy title matching (e.g. trigram similarity) is the next obvious improvement.
- **No full-text search.** The current `/` filter searches title + source only. Indexing descriptions and using a small client-side search like MiniSearch would close that gap without adding a server.
- **No personalisation.** Could rank by topics I read most, sources I save from most. Adds complexity without removing a real pain point — deliberately deferred.

## Run it yourself

It's a public repo. Fork it, change the sources in `scripts/fetch-news.mjs`, enable Actions, enable Pages on the `main` branch. That's the entire deploy.

---

**Author:** Srikanth Chandra · [LinkedIn](https://www.linkedin.com/in/srikanthchandra/) · [GitHub](https://github.com/srikanthchandra174)
