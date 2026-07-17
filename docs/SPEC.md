# Retraced — BetterDiscord Statistics Plugin (Product Spec)

> Verbatim working spec. Phases are built one at a time with a verification stop after each.

Retraced (retraced.cc) is a BetterDiscord plugin that records the user's own Discord behaviour locally and renders it as a statistics page inside the client.

---

## 1. Core principles (do not violate these)

1. **Everything stays on device.** No network calls of any kind, ever. No telemetry, no error reporting, no CDN fetches at runtime. All dependencies bundled. If you find yourself writing `fetch` to anything other than Discord's own internal modules, stop.
2. **Message content is stored as plaintext on device, but scoped.** In **DMs and group DMs**: both sides, in full. In **guild channels**: the user's own messages only — other people's guild messages contribute to counts, rollups and content-type flags, but their text is never written to disk. This split is a hard rule, enforced at the capture layer (not the UI), and it should be the first thing a reader of the code can verify. Peers are keyed by their real user ID with display name cached for labels. Because DM content is real personal data about real people, the Data tab is not an afterthought — per-peer wipe, date-range wipe, full wipe, and export must all work from Phase 7, and a global "content storage" kill switch (default **on**, but honoured everywhere) must stop capture and purge existing content without destroying the rollups.
3. **Aggregate on write, never on read.** Charts read pre-computed rollups. A chart render must never scan the raw event log. `BdApi.Data` is JSON-file-backed and will die at this volume — it is only for settings.
4. **Never block the UI thread.** Discord is the product; Retraced is a guest. Writes are batched and debounced. Heavy aggregation goes in a Worker if it exceeds a few ms.
5. **The plugin must survive being disabled, re-enabled, and updated** without data loss or duplicate listeners.

---

## 2. Stack & structure

- Plugin source in TypeScript, bundled by **esbuild** into a single `Retraced.plugin.js` with the BD meta header.
- React comes from `BdApi.React` — alias `react` and `react-dom` to it in the esbuild config so bundled chart libs use Discord's instance. Do **not** ship a second React.
- **Recharts** for standard charts (line, bar, area, donut, scatter, radial, streamgraph via stacked area with `baseValue`).
- **d3** (`d3-chord`, `d3-force`, `d3-sankey`, `d3-scale`, `d3-shape` only — no `d3` meta-package) for chord, force graph, sankey.
- Heatmaps and calendar heatmap: hand-rolled SVG. Don't reach for a library.
- If a chart drops frames on a year of data, swap that chart to **uPlot**. Don't pre-optimise.
- `idb` (Jake Archibald's wrapper) over raw IndexedDB.

Suggested layout:

```
src/
  index.ts              # BD plugin class: start/stop, lifecycle
  patcher/              # Discord internals: dispatcher hooks, webpack module finds
  db/                   # schema, migrations, write path, read queries
  aggregate/            # event -> rollup reducers
  ui/
    page/               # the stats page + tabs
    charts/             # one file per chart, each takes plain data props
    components/         # summary cards, filters, empty states
  settings/
  export/               # JSON export/import
```

Charts must be pure presentational components taking already-shaped props. No chart component touches the DB.

---

## 3. Data capture

Hook Discord's Flux dispatcher (find it via webpack, subscribe rather than monkey-patching where possible). Events of interest:

| Event | What we take from it |
|---|---|
| `MESSAGE_CREATE` | own + others in channels we have open; timestamp, channelId, guildId, authorId, content-type flags, char/word count, whether it's a reply and to whom. **Content written only if: it's the user's own message, OR the channel is a DM/group DM.** Otherwise the text is dropped at the reducer and never reaches `messages`. |
| `MESSAGE_UPDATE` | edits — count + latency from original send; keep the prior revision alongside the new content, subject to the same content rule |
| `MESSAGE_DELETE` | deletes — count + lifetime before deletion; retain last known content only where that content was storable under the rule above |
| `TYPING_START` | **critical** — own typing starts, per channel, with timestamp |
| `CHANNEL_SELECT` | channel dwell time (open → next select), guildId |
| `MESSAGE_REACTION_ADD/REMOVE` | reactions given vs. received |
| `VOICE_STATE_UPDATE` | own VC join/leave, and who else is present in the same channel |
| `PRESENCE_UPDATE` | ignore — too noisy, no payoff |

**Hesitation detection.** This is the flagship metric and needs care. Maintain an in-memory map of `channelId -> {startedAt, lastSeen}` for the user's own `TYPING_START`. Discord re-fires typing roughly every 8–10s while actively typing, and it lapses after ~10s of inactivity. Resolve a typing session when either:
- a `MESSAGE_CREATE` from self lands in that channel → **committed**, record duration
- no refresh for >12s and no message → **aborted**, record duration

Emit `{channelId, guildId, durationMs, committed: bool}`. Guard against: switching channels mid-type, edits triggering typing, and the client's own typing throttle. Log both counts; hesitation index = aborted / (aborted + committed).

**Reply latency.** For DMs and replies: time between the previous message from the other party and the user's next message in that channel, capped at some ceiling (e.g. 6h) so overnight gaps don't poison the median. Store the distribution as histogram buckets per peer, not raw values — bucketed log-ish scale (0–10s, 10–30s, 30s–2m, 2m–10m, 10m–1h, 1h–6h, 6h+). Store both directions.

**Conversation initiation.** A message opens a new conversation if the previous message in that channel was >30min prior (make this a setting). Attribute the initiation to its author. Per-peer counters: `initiatedByMe`, `initiatedByThem`.

**Lurk ratio.** From `CHANNEL_SELECT` dwell time vs. messages sent in that channel. Only count dwell while the window is focused — check document visibility/focus so an idle background client doesn't record 9 hours of "reading."

---

## 4. Storage schema (IndexedDB via `idb`)

DB name `retraced`, versioned with a real migration path.

- `meta` — schema version, install date, last-flush marker.
- `events` — append-only ring buffer, keyed by autoincrement, indexed by `ts`. **Capped at N days (default 30, setting-configurable).** This exists so rollups can be rebuilt after a bug; it is not the source of truth. Prune on start and on a timer.
- `messages` — key `messageId` → `{ts, channelId, guildId, authorId, content, revisions: [{ts, content}], deletedAt, replyToId, contentTypes, chars, words}`. Indexes on `ts`, `channelId`, `authorId`. **`content` and `revisions` are populated only for own messages, or for any message in a DM/group DM.** For other people's guild messages the row is still written (it carries counts, reply edges and content-type flags) but `content` is `null` — do not write empty strings, `null` is the explicit marker for "not storable." A single `isContentStorable(msg)` predicate should be the only place this decision is made. This store dominates size; give it its own retention setting (default: unlimited) and surface row count and byte estimate prominently on the Data tab. Charts do not read this store — rollups remain the render path.
- `daily` — key `[date, channelId]`. `{guildId, sent, edited, deleted, chars, words, uniqueWords, typingCommitted, typingAborted, typingMs, dwellMs, reactionsGiven, reactionsReceived, contentTypes: {text,image,link,gif,sticker,attachment}, initiatedByMe, initiatedByThem}`. Indexes on `date` and `guildId`.
- `hourly` — key `[date, hour]` → `{sent}`. Feeds the radial clock, day×hour heatmap, night-owl score.
- `peers` — key `userId` → `{label, avatarHash, msgToThem, msgFromThem, initiatedByMe, initiatedByThem, latencyBucketsMine: number[], latencyBucketsTheirs: number[], typingAbortedAtThem, lastSeenTs, firstSeenTs}`.
- `voice` — key `[date, channelId]` → `{seconds, coPresent: {userId: seconds}}`.
- `emoji` — key `[guildId, emojiId]` → `{name, count}`.
- `domains` — key `domain` → `{count, lastTs}`.

Write path: events land in an in-memory buffer, reduced into pending rollup deltas, flushed in a single `readwrite` transaction on a debounce (~5s) **and** on `beforeunload` / plugin stop. One transaction per flush, not per event.

Every chart must be answerable by one `getAll(IDBKeyRange.bound(...))` over one store. If a chart can't, the schema is wrong — fix the schema, not the chart.

---

## 5. The stats page

Inject a Retraced entry into Discord's user settings sidebar (that's the least fragile mount point; also add a command/keybind to open it). Full-page React tree, tabbed, styled with Discord's CSS variables so it inherits themes — never hardcode colours.

Global controls: time range (30d / 90d / 1y / all), and a server/DM filter where meaningful.

### Tab: Overview
- Hero **Sankey**: You → servers → top channels.
- Summary cards: night owl %, current active streak, longest conversation burst, most-messaged person, ghost rate, hesitation index.
- Messages per day line chart.
- **Streamgraph** of server share over time — this one is the screenshot. Make it the best-looking thing on the page.
- **Calendar heatmap**, GitHub-style, one row per year.

### Tab: Rhythm
- **Radial clock** — 24-spoke polar chart of hour-of-day activity. Not a bar chart.
- **Day × hour heatmap**, 7×24 grid.
- Night owl score by month, line.
- Session length distribution.

### Tab: Hesitation
- Hesitation index over time, line.
- Per-channel aborted-vs-committed, diverging bar, sortable.
- Per-person hesitation, bar. (Who do you type at and then delete?)
- Edit rate and delete rate per channel, bar.
- Median time-to-delete.

### Tab: People
- **Conversation initiator ratio** — diverging horizontal bar, one row per DM, sortable. This is the emotionally loaded one; it should look calm and clean, not like an accusation.
- Median reply time per person, sortable bar. Killer view — make sorting instant.
- Reply latency distribution, histogram, mine vs. theirs overlaid, per selected person.
- **Force-directed social graph**. Lazy-mount only when the tab is opened; cap node count and provide a threshold slider.
- Reactions given vs. received, diverging bar.

### Tab: Content
- Content type split, donut.
- Top custom emoji per server, bar, with the actual emoji rendered as the axis label.
- Top 10 link domains, bar.
- Vocabulary richness over time (unique/total), line. Yours spans everywhere; theirs is DM-only — label this on the chart rather than silently mixing scopes.
- Most-used words and phrases, yours vs. theirs — bar, with a stopword list you can edit in settings. The "theirs" side is DMs only; say so in the UI.
- Message length distribution over time, yours vs. theirs (theirs DM-scoped).
- Full-text search across stored messages, scoped by peer/channel/date. Results cover all your own messages plus all DM traffic; guild messages from other people are not searchable and the empty state should explain why rather than looking broken. Back the search with an inverted index in its own store rather than scanning `messages` — the scan will not stay fast.

### Tab: Voice
- Minutes in VC over time.
- **Chord diagram** of co-occurrence, weighted by shared minutes.
- Top VC channels.

### Tab: Data
- Export everything to JSON. Import it back.
- Per-store row counts and estimated size.
- Wipe: all, or a single peer, or a date range, or **content only** (drop `messages` and the search index, keep every rollup and therefore every chart except the content-level ones).
- Rebuild rollups from `events`.

Empty and thin-data states matter — a fresh install has nothing. Every chart needs a graceful "not enough data yet, come back in a week" state. Never render an axis with no series.

---

## 6. Constraints & gotchas

- Webpack module finds break on Discord updates. Isolate **every** internal lookup in `patcher/`, make each one fail soft with a console warning, and degrade the affected feature rather than crashing the plugin.
- `stop()` must remove every listener, cancel every timer, unmount every root, and flush pending writes. Enable → disable → enable must not double-count.
- With full content retention the DB grows without bound. Estimate early: a busy user is plausibly 100k–500k messages/year. Measure real byte size against a synthetic year in Phase 2 and report the number before going further — if it's ugly, add compression or a retention default rather than discovering it in month eight. Also call `navigator.storage.persist()` so the origin isn't eligible for eviction under storage pressure.
- Assume IndexedDB may be wiped by a Discord update or reinstall. Prompt the user to export periodically (a gentle card on the Data tab, not a nag).
- Don't touch the message DOM. Everything comes from the dispatcher.
- Test with synthetic data: write a dev-only generator that fabricates two years of plausible events so charts can be developed without waiting.

---

## 7. Build phases

**Phase 1 — Skeleton.** BD plugin lifecycle, esbuild config with React aliased to `BdApi.React`, settings panel, a stats page that mounts and renders "hello". Verify it survives enable/disable cycles.

**Phase 2 — Capture + storage.** Dispatcher hooks, the hesitation state machine, the reducer layer, IndexedDB schema, debounced flush, the event ring buffer and its pruning. No UI yet beyond a raw counter readout. Include the synthetic data generator, and unit tests for `isContentStorable` covering: own guild message (store), other's guild message (drop), own DM (store), other's DM (store), other's group DM (store), thread inside a guild (drop — threads carry a `guildId`, make sure the predicate doesn't mistake them for DMs). **This is the phase that matters most — get it right before any chart exists.**

**Phase 3 — Overview tab.** Summary cards, messages/day, calendar heatmap, streamgraph, Sankey.

**Phase 4 — Rhythm + Hesitation tabs.** Radial clock, day×hour heatmap, hesitation charts.

**Phase 5 — People tab.** Initiator ratio, reply latency, force graph.

**Phase 6 — Content + Voice tabs.** Includes the inverted search index and full-text search.

**Phase 7 — Data tab.** Export/import, wipe, rebuild. Then polish, perf pass, empty states.

Build one phase at a time; stop at the end of each phase for verification before continuing.
