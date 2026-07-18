# Retraced

**Local-only statistics about your own Discord activity, rendered inside the client.**

Retraced is a [BetterDiscord](https://betterdiscord.app) plugin that records your own Discord behaviour — when you chat, how long you hesitate before sending, who reaches out first, the words you lean on — and turns it into a statistics page you open with a hotkey. Everything stays on your device: no servers, no telemetry, no CDN bundles, and the build is tested to contain no network calls.

**Website / download:** [retraced.cc](https://retraced.cc) · **Version:** 1.0.0

---

## What it shows

Seven tabs, eighteen charts:

- **Overview** — where your messages go: totals, messages per day, an activity calendar, a streamgraph of servers and DMs over time, and a Sankey of where your words end up.
- **Rhythm** — when you're on Discord: a radial 24-hour clock, your week as a day × hour heatmap, and how long your messaging sessions run.
- **Hesitation** — the messages you typed and then didn't send: aborted drafts, long pauses before sending, edits and deletions — where, at whom, how often.
- **People** — your circle: who reaches out first, who replies faster, reply-latency distributions, and a force graph of who you actually talk to.
- **Content** — the words and phrases you lean on, message-length bands, and full-text search over your own stored history.
- **Voice** — minutes in voice channels and who you share them with.
- **Data** — export, import, wipe, rebuild. The boring tab that keeps everything honest.

Charts fill in as you chat. The first week is quiet; the first month is honest.

## Privacy model

Privacy is enforced where messages are *captured*, not in the UI — text that isn't allowed to be stored never reaches disk in the first place.

**The content rule:**

| Where | What is stored |
|---|---|
| DMs | both sides, in full |
| Group DMs | both sides, in full |
| Servers | **your own messages only** — other people's server text never reaches disk |

- **Nothing leaves the device.** No network calls, no telemetry, no error reporting. An automated test asserts the compiled bundle contains no `fetch`, `XMLHttpRequest`, or `WebSocket` usage.
- **A kill switch that means it.** Turning off *Store message content* stops capture **and erases the text it already stored** (messages, search index, word counts). Your counts and charts survive.
- **Yours to keep, yours to shred.** Export everything to a single JSON file and import it back. Wipe everything, stored text only, one person, or a date range.
- **One deliberate exception:** the top-custom-emoji chart loads emoji *images* from Discord's own CDN (`cdn.discordapp.com/emojis/…`) — the same URLs the client itself loads constantly. Nothing but an emoji id is involved, and a text `:name:` fallback renders if the image can't load.

All data lives in IndexedDB inside Discord's own profile directory. Plugin *settings* (toggles, retention) live in BetterDiscord's plugin data folder.

## Install

1. Install [BetterDiscord](https://betterdiscord.app).
2. Download [`Retraced.plugin.js`](https://retraced.cc/Retraced.plugin.js) (or grab [`Retraced.plugin.js`](./Retraced.plugin.js) from the root of this repo — same file, built from this source) and drop it into your plugins folder: `%appdata%\BetterDiscord\plugins` on Windows, or *Settings → Plugins → Open Plugins Folder*.
3. Enable **Retraced** in the plugin list.

Then open the statistics page any of three ways:

- press **Ctrl+Shift+H** anywhere in Discord,
- the **Retraced → Statistics** entry in User Settings (best-effort; the hotkey always works even if Discord's internals shift),
- the **Open statistics page** button in the plugin's settings panel.

The `Retraced.plugin.js` at the repo root is the actual release artifact, committed unminified so you can read exactly what you're running — BetterDiscord requires plugin code to be reviewable, and "the source is public" only counts if the shipped file matches it.

## How much does it store?

Measured, not guessed (`node scripts/measure-storage.mjs` re-runs the harness in a real Chromium IndexedDB):

- A synthetic year of heavy use (41k events, 24k messages) occupies **~24 MiB**; messages dominate at **~408 bytes each**.
- The full-text search index roughly doubles the logical footprint (540 synthetic days: 46.8 MB logical, 28.9 MB of it index).
- Extrapolated to an extreme 500k messages/year: **~220 MB/yr** — the message-retention setting is the pressure valve.

The Data tab shows live per-store numbers for *your* database.

## Development

```
npm install
npm test           # vitest — 282 tests (jsdom + real React standing in for Discord's)
npm run typecheck  # tsc --noEmit
npm run build      # -> Retraced.plugin.js in the repo root (unminified, BD meta header verbatim)
npm run dev        # watch + auto-copy into the BetterDiscord plugins folder
npm run install:bd # one-shot build + copy

node scripts/preview.mjs          # visual harness: real charts + synthetic data at http://127.0.0.1:8735
node scripts/measure-storage.mjs  # storage measurement harness at http://127.0.0.1:8734
```

The install scripts copy to `%APPDATA%\BetterDiscord\plugins` (override with the `BETTERDISCORD_PLUGINS_DIR` env var).

### Architecture

- **React is never bundled.** esbuild aliases `react`, `react-dom`, and `react/jsx-runtime` to shims backed by `BdApi.React` (`src/shims/`), so the plugin always uses Discord's own React instance. A build test asserts no React internals leak into the bundle.
- **Every Discord-internal lookup lives in `src/patcher/`** and fails soft: a miss logs a warning and degrades that one feature — it never crashes the plugin.
- **Lifecycle is disposer-based** (`src/lifecycle/disposer.ts`): every side effect registers its undo; `stop()` runs them in reverse. Enable → disable → enable is covered by tests.
- **`BdApi.Data` is for settings only.** All capture data goes to IndexedDB (schema v3: events ring buffer, per-day rollups, sessions, peers, word counts, and a full-text inverted index). Older databases upgrade in place.
- **Charts are pure presentational components** fed by pre-computed rollups; no chart touches the database.
- **The content rule holds by construction:** only storable text is ever tokenized, so other people's server messages can never appear in word charts or search results.
- Chart series colors are fixed palettes validated for color-vision deficiency and contrast against Discord's dark and light themes; every multi-series chart also has a legend and a "Data" table view. Color follows the entity — a server keeps its color across time-range switches.

### Repository layout

```
Retraced.plugin.js  # the committed release build (unminified) — output of npm run build
src/
  index.ts          # BD plugin class: start/stop, hotkey, wiring
  env/bd.ts         # single BdApi access point + logging
  lifecycle/        # Disposer
  patcher/          # ALL Discord-internal lookups (webpack finds, React roots, settings sidebar)
  settings/         # typed settings store (BdApi.Data) + panel UI
  shims/            # react / react-dom / jsx-runtime -> BdApi.React
  ui/               # overlay controller, stats page shell, styles
scripts/            # esbuild config + build/install/preview/measure scripts
site/               # retraced.cc landing page + nginx config
tests/              # vitest suites + BdApi mock
docs/SPEC.md        # full product spec
```

## Data management

- **Export/import**: one JSON envelope of every store; import validates, then replaces. The Data tab nudges (gently) when the last export is stale.
- **Wipes**: everything · content only (text, search index, word counts — rollups survive) · one person (their peer row, messages, postings, and events) · a date range (date-scoped stores only; all-time aggregates stay).
- **Repair**: rebuild recent statistics (replays the event ring buffer through the real reducers) and rebuild the search index (re-reads all stored messages — also the backfill path for history captured before the index existed).

## retraced.cc deployment

The website (`site/`) and the plugin ship as one Docker image: a multi-stage build compiles `Retraced.plugin.js` from source and nginx serves it alongside the landing page (`/Retraced.plugin.js` is always the current build, sent as a download).

- `Dockerfile` — plugin build + static site image
- `docker-compose.yml` — the Portainer stack definition (set `RETRACED_IMAGE` and optionally `RETRACED_PORT` in the stack's environment; terminate TLS at your reverse proxy)
- `.github/workflows/release.yml` — on every push to `main`: run the test suite, build the image, push it to the registry as `retraced-site:latest` + `:sha`, then POST the Portainer stack webhook so the stack re-pulls and redeploys

Repository secrets the workflow needs: `REGISTRY_HOST`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`, `PORTAINER_WEBHOOK_URL`.

Local check: `docker build -t retraced-site .` then `docker run --rm -p 8090:80 retraced-site`.

## Disclaimer

BetterDiscord modifies the Discord client, which is against Discord's Terms of Service — the same caveat as every BD plugin. Retraced itself only ever *reads* what your own client already sees, stores it locally, and sends nothing anywhere.
