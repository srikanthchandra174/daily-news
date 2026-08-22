# Daily Briefing

A serverless news aggregator that pulls 18 sources every 6 hours, weighted towards India, and serves them as a clean, keyboard-driven reader. Built to replace the time sink of scrolling Instagram or YouTube for "what's happening today."

**Live:** https://srikanthchandra174.github.io/daily-news/

---

## Why this exists

Most news apps are designed to keep you scrolling. This one is designed to get you in and out in 60 seconds: a single recency-sorted stream, topic filters, read-state tracking, save-for-later, and vim-style keyboard navigation. No ads, no infinite scroll, no algorithm.

It also exists as a small engineering exercise in solving a real problem the boring-correct way: the first version of this hit every classic browser-side dead end (CORS, flaky public proxies, ISP-level blocking), and the working architecture only emerged after I treated the failure data as a debugging problem, not a configuration problem.

## Architecture

```
                                  every 6 hours cron
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │   GitHub Actions     │   server-side fetch
   18 RSS / JSON sources ──►│   (Ubuntu runner,    │── no CORS, no proxy
                            │    Node 20)          │   no ISP blocking
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
| GitHub Actions cron over a dedicated server | A refresh every 6 hours doesn't justify a running process. A scheduled Action gives the same outcome with no server to maintain, monitor, or pay for. |
| Static `news.json` checked into the repo | The browser only reads same-origin static files. No backend, no API, no auth — and the file is browseable, diff-able, and version-controlled. |
| Zero runtime dependencies | The fetch script uses only Node's built-in `fetch` and a hand-rolled regex RSS/Atom parser. No npm install step in the workflow. Faster runs, no supply-chain surface. |
| Vanilla HTML/CSS/JS, no framework | The page is one ~14 KB file. Loads instantly on any device, including over 2G. No build pipeline to maintain. |
| `localStorage` for read-state and saves | Per-device, no account system needed. Degrades gracefully if storage is blocked. |

## Features

- **18 sources across 7 topics** — India, Hyderabad, Markets, AI/Tech, Jobs, World, Movies — roughly 65% India-origin by design
- **Two filter axes** — `topic` (what it's about) and `region` (where it's from), so one chip gives you Indian tech, Indian markets and Indian movies at once
- **Auto-refresh every 6 hours** via GitHub Actions cron (07:00 / 13:00 / 19:00 / 01:00 IST)
- **Keyboard navigation** — `j`/`k` to move, `o` to open, `s` to save, `h` to hide read, `r` to refresh, `/` to filter
- **Read-state tracking** — opened items dim automatically; toggle to hide them entirely
- **Saved articles** — star anything; the full article is stored locally, so saves survive the feed turnover
- **NEW badges** on articles published since the last visit
- **Light / dark theme** — defaults to your OS preference, remembers your choice
- **No tracking, no analytics, no ads** — all of them would be easy to add; they're absent by choice

## Tech stack

| Layer | Technology |
|---|---|
| Data pipeline | Node 20 on GitHub Actions (Ubuntu runner) |
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
├── news.json                   # Latest aggregated feed; rewritten every 6 hours by the Action
├── scripts/
│   ├── fetch-news.mjs          # Node script: fetches sources, parses, dedupes, sorts
│   └── check-feeds.mjs         # Verifies every feed URL still responds and parses
└── .github/
    └── workflows/
        └── fetch-news.yml      # GitHub Actions: cron schedule + push trigger
```

## Adding or changing sources

Edit `scripts/fetch-news.mjs` and commit. The push automatically triggers a fresh fetch — no deploy step needed.

```js
// For RSS feeds, add to the FEEDS array:
{ name:'Reuters World', topic:'world', region:'global', limit:6,
  url:'https://...', verified:'listed' }

// For JSON APIs, add to SOURCES with a custom adapter function.
```

`region` is the origin axis (`in` / `global`) and drives the 🇮🇳 filter chip.
`limit` caps how many items that feed contributes — this is the lever that
controls the India/global ratio, not the number of feeds.

Always verify a new URL before committing it:

```bash
node scripts/check-feeds.mjs   # per-feed OK/FAIL, item count, date coverage
node scripts/fetch-news.mjs    # full run; refuses to write if under 40 items
```

## What I'd do differently / next

Honest about the limits and the next iteration:

- **Schedule precision.** GitHub's free cron is best-effort and drifts 5–15 minutes. At a 6-hour cadence this is invisible; for anything time-critical, a self-hosted runner or a real cron host is the upgrade.
- **Deduplication is title-normalisation, not semantics.** Headlines are reduced to their first six significant words and collapsed on collision. This catches the common case (six Indian dailies running the same wire copy) but misses genuinely different phrasings of one story, and could in principle collapse two distinct stories that share an opening. Trigram or embedding similarity would be the real fix.
- **Search is substring, not indexed.** The `/` filter now covers title, source and description, but it's a linear `includes()` scan. Fine at ~200 items; a client-side index like MiniSearch would be needed past a few thousand.
- **No personalisation.** Could rank by topics I read most, sources I save from most. Adds complexity without removing a real pain point — deliberately deferred.

## Run it yourself

It's a public repo. Fork it, change the sources in `scripts/fetch-news.mjs`, enable Actions, enable Pages on the `main` branch. That's the entire deploy.

---

**Author:** Srikanth Chandra · [LinkedIn](https://www.linkedin.com/in/srikanthchandra/) · [GitHub](https://github.com/srikanthchandra174)
