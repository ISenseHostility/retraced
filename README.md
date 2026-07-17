# Retraced

A BetterDiscord plugin that records **your own** Discord behaviour locally and renders it as a statistics page inside the client. Everything stays on this device: no network calls, no telemetry, all dependencies bundled.

Full product spec: [docs/SPEC.md](docs/SPEC.md). Build phases and status below.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Skeleton: lifecycle, esbuild + React aliasing, settings panel, stats page shell | ✅ done |
| 2 | Capture + storage: dispatcher hooks, hesitation state machine, IndexedDB, reducers | ✅ done |
| 3 | Overview tab (cards, messages/day, calendar heatmap, streamgraph, Sankey) | ✅ done |
| 4 | Rhythm + Hesitation tabs (radial clock, day×hour heatmap, hesitation charts) | ✅ done |
| 5 | People tab (initiator ratio, reply speed, latency distributions, force graph) | ✅ done |
| 6 | Content + Voice tabs (words, length bands, full-text search index, chord) | ✅ done |
| 7 | Data tab (export/import, wipes, rebuild, kill-switch purge) | ✅ done |

## Development

```
npm install
npm test           # vitest (jsdom + real React standing in for Discord's)
npm run typecheck  # tsc --noEmit
npm run build      # -> dist/Retraced.plugin.js (minified; BD meta header kept verbatim)
npm run dev        # watch + auto-copy into the BetterDiscord plugins folder
npm run install:bd # one-shot build + copy

node scripts/preview.mjs          # visual harness: real charts + synthetic data at http://127.0.0.1:8735
node scripts/measure-storage.mjs  # storage measurement harness at http://127.0.0.1:8734
```

Chart series colors are fixed palettes validated (CVD + contrast) against Discord's
dark `#2b2d31` and light `#f2f3f5` card surfaces; chrome and ink come from Discord's
live CSS variables. Low-contrast slots are covered by the relief rule: every
multi-series chart has a legend and a "Data" table view. Color follows the entity —
a guild keeps its slot across time-range switches (all-time volume ordering), on
the Hesitation tab committed=blue / aborted=orange and edited=purple / deleted=red
are held consistently across charts, and on the People tab you=blue / them=teal
(all pairs validator-checked). The People tab reads the all-time `peers` store, so
the global time-range filter deliberately does not apply there — the tab says so.

The IndexedDB schema is at **v3**: Phase 4 added a `sessions` store (per-day
histograms of gap-bounded messaging-session lengths, 30-minute gap) with the open
session persisted in `meta` so restarts don't split it; Phase 6 added `words`
(word/bigram counts per content-rule scope, with a count index for top-N cursors)
and `searchIndex` (the full-text inverted index, keyed `[term, messageId]`).
Everything derived from content obeys the content rule and the kill switch by
construction — only storable text is ever tokenized, so other people's guild
messages can never appear in word charts or search results. Older databases
upgrade in place; pre-upgrade days simply lack the new rollups until Phase 7's
rebuild-from-events.

One deliberate exception to "no network": the Top-custom-emoji chart labels rows
with the emoji image from **Discord's own CDN** (`cdn.discordapp.com/emojis/…`),
the same URLs the client itself loads constantly; no user data leaves the device
beyond an emoji id, and a text `:name:` fallback renders when the image can't load.

The install scripts copy to `%APPDATA%\BetterDiscord\plugins` (override with the `BETTERDISCORD_PLUGINS_DIR` env var).

### Using it

Enable **Retraced** in BetterDiscord's plugin list, then:

- press **Ctrl+Shift+H** anywhere in Discord, or
- use the **Retraced → Statistics** entry in User Settings (best-effort; survives via hotkey if Discord's internals shift), or
- the **Open statistics page** button in the plugin's settings panel.

## Storage footprint (measured)

Phase 2, a synthetic year (41,185 events, 24,439 messages) in real Chromium IndexedDB:

- physical usage (`navigator.storage.estimate()`): **23.7 MiB** with the full-year ring buffer, **15.1 MiB** after pruning events to 30 days (before LevelDB compaction)
- messages dominate at **~408 bytes/message**; extrapolated to the spec's busy-user ceiling (500k msgs/yr) ≈ **~220 MB/yr** — acceptable without compression; the message-retention setting is the pressure valve

Phase 6's search index roughly doubles the logical footprint: 540 synthetic days
measured **46.8 MB logical** (search index 28.9 MB / 287k postings, messages
13.8 MB / 35k rows, everything else under 4 MB). The Data tab shows the live
per-store numbers; "content only" wipe reclaims the text-derived stores whole.

Re-run any time with `node scripts/measure-storage.mjs` and a browser pointed at the printed URL.

## Data management (Phase 7)

- **Export/import**: one JSON envelope of every store; import validates, then
  replaces. The Data tab nudges (gently) when the last export is stale.
- **Wipes**: everything · content only (text, search, words — rollups survive,
  ring-buffer events keep their counts but lose their text) · one person
  (their peer row, messages, postings, and events) · a date range (date-scoped
  stores only; all-time aggregates stay).
- **The kill switch purges**: turning "Store message content" off runs the
  content-only wipe as well as stopping capture (spec §1.2).
- **Repair**: rebuild recent statistics (replays the event ring buffer through
  the real reducers for date-scoped rollups; deletions re-derive from stored
  messages) and rebuild the search index (re-reads all stored messages — also
  the backfill path for history captured before the index existed).

## Architecture notes

- **React is never bundled.** esbuild aliases `react`, `react-dom`, and `react/jsx-runtime` to shims backed by `BdApi.React` (`src/shims/`). A build test asserts no React internals leak into the bundle.
- **Every Discord-internal lookup lives in `src/patcher/`** and fails soft: a miss logs a warning and degrades that feature, never crashes the plugin.
- **Lifecycle is disposer-based** (`src/lifecycle/disposer.ts`): every side effect registers its undo; `stop()` runs them in reverse. Enable → disable → enable is covered by tests.
- **`BdApi.Data` is for settings only.** All capture data goes to IndexedDB from Phase 2.
- Charts (Phase 3+) must be pure presentational components fed by pre-computed rollups; no chart touches the DB.

## retraced.cc deployment

The website (in `site/`) and the plugin ship as one Docker image: a multi-stage
build compiles `Retraced.plugin.js` from source and serves it alongside the
landing page via nginx (`/Retraced.plugin.js` is always the current build,
sent as a download).

- `Dockerfile` — plugin build + static site image
- `docker-compose.yml` — the Portainer stack definition (set `RETRACED_IMAGE`
  and optionally `RETRACED_PORT` in the stack's environment; terminate TLS for
  retraced.cc at your reverse proxy)
- `.github/workflows/release.yml` — on every push to `main`: run the test
  suite, build the image, push it to the registry as
  `retraced-site:latest` + `:sha`, then POST the Portainer stack webhook so
  the stack re-pulls and redeploys

Repository secrets the workflow needs: `REGISTRY_HOST`, `REGISTRY_USERNAME`,
`REGISTRY_PASSWORD`, `PORTAINER_WEBHOOK_URL`. In Portainer, create the stack
from this repo (or paste the compose file), enable **Re-pull image and
redeploy** on its webhook, and put the webhook URL into the secret.

Local check: `docker build -t retraced-site .` then
`docker run --rm -p 8090:80 retraced-site`.

## Layout

```
src/
  index.ts          # BD plugin class: start/stop, hotkey, wiring
  env/bd.ts         # single BdApi access point + logging
  lifecycle/        # Disposer
  patcher/          # ALL Discord-internal lookups (webpack finds, React roots, settings sidebar)
  settings/         # typed settings store (BdApi.Data) + panel UI
  shims/            # react / react-dom / jsx-runtime -> BdApi.React
  ui/               # overlay controller, stats page shell, styles
scripts/            # esbuild config + build/install script
tests/              # vitest suites + BdApi mock
```
