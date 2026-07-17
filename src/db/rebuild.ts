import { DELETE_BUCKET_BOUNDS_MS, DELETE_BUCKET_COUNT, addToBuckets } from "../aggregate/buckets";
import { PendingBuffer } from "../aggregate/pending";
import { createReducerContext, reduceEvent } from "../aggregate/reducers";
import { dateKey } from "../util/time";
import { bigrams, tokenize } from "../util/tokenize";
import { emptyDaily, flushPending } from "./flush";
import type { RetracedDatabase } from "./schema";

/**
 * The two repair paths (spec §5 Data tab):
 *  - rebuildFromEvents: replays the ring buffer through the REAL reducers to
 *    restore the date-scoped rollups (daily/hourly/voice/sessions) inside the
 *    buffer's window. All-time aggregates (peers, emoji, domains, words) are
 *    left alone — replaying a partial window into them would double-count.
 *  - rebuildContentIndex: regenerates words + searchIndex from the messages
 *    store — exact, all-time, and the backfill path for pre-index installs.
 */

const BATCH = 2_000;

export async function rebuildFromEvents(db: RetracedDatabase, opts: { conversationGapMinutes: number }): Promise<{ events: number }> {
  const eventRows = await db.getAll("events");
  if (eventRows.length === 0) return { events: 0 };
  eventRows.sort((a, b) => a.ts - b.ts);
  const fromDate = dateKey(eventRows[0]!.ts);
  const toDate = dateKey(eventRows[eventRows.length - 1]!.ts);

  // 1) clear the window's date-scoped rollups
  {
    const tx = db.transaction(["daily", "hourly", "voice", "sessions"], "readwrite");
    let dailyCursor = await tx.objectStore("daily").index("date").openCursor(IDBKeyRange.bound(fromDate, toDate));
    while (dailyCursor) {
      await dailyCursor.delete();
      dailyCursor = await dailyCursor.continue();
    }
    void tx.objectStore("hourly").delete(IDBKeyRange.bound([fromDate, 0], [toDate, 23]));
    void tx.objectStore("voice").delete(IDBKeyRange.bound([fromDate, ""], [toDate, "￿"]));
    void tx.objectStore("sessions").delete(IDBKeyRange.bound(fromDate, toDate));
    await tx.done;
  }

  // 2) replay through the real reducers, flushing only the date-scoped deltas.
  // Heads start empty: initiation attribution can differ slightly at the very
  // start of the window (no memory of what came before) — documented drift.
  const ctx = createReducerContext({
    ownUserId: "", // only read on peer-attribution paths, whose outputs are stripped below
    settings: () => ({ conversationGapMinutes: opts.conversationGapMinutes }),
    resolvePeerLabel: () => null,
    dmRecipients: () => null,
  });
  for (let i = 0; i < eventRows.length; i += BATCH) {
    const pending = new PendingBuffer();
    for (const row of eventRows.slice(i, i + BATCH)) reduceEvent(row.event, pending, ctx);
    // strip everything NOT date-scoped — those stores were never wiped
    pending.events = [];
    pending.messageCreates.clear();
    pending.messageEdits = [];
    pending.messageDeletes = [];
    pending.peers.clear();
    pending.emoji.clear();
    pending.domains.clear();
    pending.words.clear();
    pending.searchIndex = [];
    await flushPending(db, pending, { now: Date.now(), heads: ctx.heads });
  }

  // 3) deletions re-derive exactly from the messages store (the replay can't
  // see them — delete attribution lives on the stored rows)
  {
    const tx = db.transaction(["messages", "daily"], "readwrite");
    const daily = tx.objectStore("daily");
    let cursor = await tx.objectStore("messages").openCursor();
    while (cursor) {
      const row = cursor.value;
      if (row.isOwn && row.deletedAt !== null) {
        const date = dateKey(row.deletedAt);
        if (date >= fromDate && date <= toDate) {
          const dailyRow = (await daily.get([date, row.channelId])) ?? emptyDaily(date, row.channelId, row.guildId);
          dailyRow.deleted += 1;
          dailyRow.deleteAfterBuckets = addToBuckets(
            dailyRow.deleteAfterBuckets,
            DELETE_BUCKET_COUNT,
            row.deleteAfterMs ?? 0,
            DELETE_BUCKET_BOUNDS_MS
          );
          await daily.put(dailyRow);
        }
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  return { events: eventRows.length };
}

export async function rebuildContentIndex(db: RetracedDatabase): Promise<{ messages: number }> {
  const tx = db.transaction(["messages", "words", "searchIndex"], "readwrite");
  void tx.objectStore("words").clear();
  void tx.objectStore("searchIndex").clear();
  const searchIndex = tx.objectStore("searchIndex");

  const wordCounts = new Map<string, number>();
  let processed = 0;
  let cursor = await tx.objectStore("messages").openCursor();
  while (cursor) {
    const row = cursor.value;
    if (row.content !== null) {
      processed++;
      const scope = row.isOwn ? "mine" : "theirs"; // !isOwn content only ever exists for DMs
      const tokens = tokenize(row.content);
      for (const token of tokens) {
        const key = `${scope} ${token}`;
        wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
      }
      for (const phrase of bigrams(tokens)) {
        const key = `${scope} ${phrase}`;
        wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
      }
      for (const term of new Set(tokens)) {
        void searchIndex.put({ term, messageId: row.messageId, ts: row.ts, channelId: row.channelId, guildId: row.guildId, isOwn: row.isOwn });
      }
    }
    cursor = await cursor.continue();
  }

  const words = tx.objectStore("words");
  for (const [key, count] of wordCounts) {
    const sep = key.indexOf(" ");
    void words.put({ scope: key.slice(0, sep) as "mine" | "theirs", term: key.slice(sep + 1), count });
  }
  await tx.done;
  return { messages: processed };
}
