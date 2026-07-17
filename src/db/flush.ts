import { DELETE_BUCKET_BOUNDS_MS, DELETE_BUCKET_COUNT, LENGTH_BUCKET_COUNT, addToBuckets, emptyBuckets } from "../aggregate/buckets";
import type { PendingBuffer } from "../aggregate/pending";
import type { ChannelHead, SessionState } from "../aggregate/reducers";
import type { ContentTypeFlags } from "../capture/types";
import { dateKey } from "../util/time";
import { tokenize } from "../util/tokenize";
import type { DailyRow, RetracedDatabase } from "./schema";

export interface FlushResult {
  events: number;
  stores: number;
}

const MAX_REVISIONS = 10;
const MAX_PERSISTED_HEADS = 500;

const clamp0 = (n: number): number => Math.max(0, n);

export function emptyDaily(date: string, channelId: string, guildId: string | null): DailyRow {
  return {
    date,
    channelId,
    guildId,
    sent: 0,
    edited: 0,
    deleted: 0,
    chars: 0,
    words: 0,
    uniqueWords: 0,
    typingCommitted: 0,
    typingAborted: 0,
    typingMs: 0,
    dwellMs: 0,
    reactionsGiven: 0,
    reactionsReceived: 0,
    contentTypes: { text: 0, image: 0, link: 0, gif: 0, sticker: 0, attachment: 0 },
    initiatedByMe: 0,
    initiatedByThem: 0,
    deleteAfterBuckets: emptyBuckets(DELETE_BUCKET_COUNT),
    longestBurst: 0,
    theirSent: 0,
    theirChars: 0,
    theirWords: 0,
    theirUniqueWords: 0,
    lengthBuckets: emptyBuckets(LENGTH_BUCKET_COUNT),
    theirLengthBuckets: emptyBuckets(LENGTH_BUCKET_COUNT),
  };
}

/**
 * Merges one swapped-out PendingBuffer into IndexedDB in a single readwrite
 * transaction (spec §4: one transaction per flush, not per event). Deletes and
 * edit revisions are resolved here, against the stored rows, inside the same
 * transaction.
 */
export async function flushPending(
  db: RetracedDatabase,
  pending: PendingBuffer,
  opts: { now: number; heads: Map<string, ChannelHead>; session?: SessionState | null }
): Promise<FlushResult> {
  if (pending.isEmpty) return { events: 0, stores: 0 };

  const tx = db.transaction(
    ["meta", "events", "messages", "daily", "hourly", "peers", "voice", "sessions", "emoji", "domains", "words", "searchIndex"],
    "readwrite"
  );
  let storeWrites = 0;

  // ring buffer — already content-scoped by the capture layer
  const events = tx.objectStore("events");
  for (const event of pending.events) {
    void events.add({ ts: event.ts, event });
  }

  // messages: creates, then edits, then deletes — same-batch sequences resolve in order
  const messages = tx.objectStore("messages");
  for (const row of pending.messageCreates.values()) {
    const existing = await messages.get(row.messageId);
    if (!existing) {
      await messages.put(row);
      storeWrites++;
    }
  }

  const searchIndex = tx.objectStore("searchIndex");
  for (const edit of pending.messageEdits) {
    const row = await messages.get(edit.messageId);
    if (!row) continue; // edit of a message that predates capture — daily.edited already counted
    if (edit.content !== null && edit.content !== row.content) {
      // reindex: stale terms out, new terms in (words rollup stays create-only by design)
      const oldTerms = new Set(row.content === null ? [] : tokenize(row.content));
      const newTerms = new Set(tokenize(edit.content));
      for (const term of oldTerms) {
        if (!newTerms.has(term)) void searchIndex.delete([term, row.messageId]);
      }
      for (const term of newTerms) {
        if (!oldTerms.has(term)) {
          void searchIndex.put({ term, messageId: row.messageId, ts: row.ts, channelId: row.channelId, guildId: row.guildId, isOwn: row.isOwn });
        }
      }
    }
    if (edit.content !== null && row.content !== null && edit.content !== row.content) {
      row.revisions.push({ ts: row.lastEditedTs ?? row.ts, content: row.content });
      if (row.revisions.length > MAX_REVISIONS) row.revisions.splice(0, row.revisions.length - MAX_REVISIONS);
    }
    if (edit.content !== null) row.content = edit.content;
    row.editCount += 1;
    row.lastEditedTs = edit.ts;
    await messages.put(row);
    storeWrites++;
  }

  // daily rows are cached locally so delete-attribution merges with the deltas
  const daily = tx.objectStore("daily");
  const dailyCache = new Map<string, DailyRow>();
  const loadDaily = async (date: string, channelId: string, guildId: string | null): Promise<DailyRow> => {
    const cacheKey = `${date} ${channelId}`;
    let row = dailyCache.get(cacheKey);
    if (!row) {
      row = (await daily.get([date, channelId])) ?? emptyDaily(date, channelId, guildId);
      if (row.guildId === null && guildId !== null) row.guildId = guildId;
      dailyCache.set(cacheKey, row);
    }
    return row;
  };

  for (const [key, delta] of pending.daily) {
    const sep = key.indexOf(" ");
    const row = await loadDaily(key.slice(0, sep), key.slice(sep + 1), delta.guildId);
    row.sent += delta.sent;
    row.edited += delta.edited;
    row.chars += delta.chars;
    row.words += delta.words;
    row.uniqueWords += delta.uniqueWords;
    row.typingCommitted += delta.typingCommitted;
    row.typingAborted += delta.typingAborted;
    row.typingMs += delta.typingMs;
    row.dwellMs += delta.dwellMs;
    row.reactionsGiven = clamp0(row.reactionsGiven + delta.reactionsGiven);
    row.reactionsReceived = clamp0(row.reactionsReceived + delta.reactionsReceived);
    for (const flag of Object.keys(row.contentTypes) as Array<keyof ContentTypeFlags>) {
      row.contentTypes[flag] += delta.contentTypes[flag];
    }
    row.initiatedByMe += delta.initiatedByMe;
    row.initiatedByThem += delta.initiatedByThem;
    row.longestBurst = Math.max(row.longestBurst ?? 0, delta.longestBurst);
    row.theirSent = (row.theirSent ?? 0) + delta.theirSent;
    row.theirChars = (row.theirChars ?? 0) + delta.theirChars;
    row.theirWords = (row.theirWords ?? 0) + delta.theirWords;
    row.theirUniqueWords = (row.theirUniqueWords ?? 0) + delta.theirUniqueWords;
    row.lengthBuckets = delta.lengthBuckets.map((n, i) => n + (row.lengthBuckets?.[i] ?? 0));
    row.theirLengthBuckets = delta.theirLengthBuckets.map((n, i) => n + (row.theirLengthBuckets?.[i] ?? 0));
  }

  for (const del of pending.messageDeletes) {
    const row = await messages.get(del.messageId);
    if (!row) continue; // predates capture — nothing to attribute
    if (row.deletedAt === null) {
      row.deletedAt = del.ts;
      row.deleteAfterMs = Math.max(0, del.ts - row.ts);
      await messages.put(row);
      storeWrites++;
      if (row.isOwn) {
        const dailyRow = await loadDaily(dateKey(del.ts), row.channelId, row.guildId);
        dailyRow.deleted += 1;
        dailyRow.deleteAfterBuckets = addToBuckets(
          dailyRow.deleteAfterBuckets,
          DELETE_BUCKET_COUNT,
          row.deleteAfterMs,
          DELETE_BUCKET_BOUNDS_MS
        );
      }
    }
  }

  for (const row of dailyCache.values()) {
    await daily.put(row);
    storeWrites++;
  }

  const hourly = tx.objectStore("hourly");
  for (const [key, sent] of pending.hourly) {
    const sep = key.indexOf(" ");
    const date = key.slice(0, sep);
    const hour = Number(key.slice(sep + 1));
    const row = (await hourly.get([date, hour])) ?? { date, hour, sent: 0 };
    row.sent += sent;
    await hourly.put(row);
    storeWrites++;
  }

  const peers = tx.objectStore("peers");
  for (const [userId, delta] of pending.peers) {
    const row = (await peers.get(userId)) ?? {
      userId,
      label: null,
      avatarHash: null,
      msgToThem: 0,
      msgFromThem: 0,
      initiatedByMe: 0,
      initiatedByThem: 0,
      latencyBucketsMine: emptyBuckets(delta.latencyMine.length),
      latencyBucketsTheirs: emptyBuckets(delta.latencyTheirs.length),
      typingAbortedAtThem: 0,
      reactionsToThem: 0,
      reactionsFromThem: 0,
      firstSeenTs: delta.firstTs,
      lastSeenTs: delta.lastTs,
    };
    if (delta.label !== null) row.label = delta.label;
    if (delta.avatarHash !== null) row.avatarHash = delta.avatarHash;
    row.msgToThem += delta.msgToThem;
    row.msgFromThem += delta.msgFromThem;
    row.initiatedByMe += delta.initiatedByMe;
    row.initiatedByThem += delta.initiatedByThem;
    row.latencyBucketsMine = delta.latencyMine.map((n, i) => n + (row.latencyBucketsMine[i] ?? 0));
    row.latencyBucketsTheirs = delta.latencyTheirs.map((n, i) => n + (row.latencyBucketsTheirs[i] ?? 0));
    row.typingAbortedAtThem += delta.typingAbortedAtThem;
    row.reactionsToThem = clamp0(row.reactionsToThem + delta.reactionsToThem);
    row.reactionsFromThem = clamp0(row.reactionsFromThem + delta.reactionsFromThem);
    row.firstSeenTs = Math.min(row.firstSeenTs, delta.firstTs);
    row.lastSeenTs = Math.max(row.lastSeenTs, delta.lastTs);
    await peers.put(row);
    storeWrites++;
  }

  const voice = tx.objectStore("voice");
  for (const [key, delta] of pending.voice) {
    const sep = key.indexOf(" ");
    const date = key.slice(0, sep);
    const channelId = key.slice(sep + 1);
    const row = (await voice.get([date, channelId])) ?? { date, channelId, guildId: delta.guildId, seconds: 0, coPresent: {} };
    row.seconds += delta.seconds;
    for (const [userId, seconds] of Object.entries(delta.coPresent)) {
      row.coPresent[userId] = (row.coPresent[userId] ?? 0) + seconds;
    }
    await voice.put(row);
    storeWrites++;
  }

  const words = tx.objectStore("words");
  const wordEntries = [...pending.words.entries()].map(([key, count]) => {
    // split at the FIRST space — bigram terms contain one of their own
    const sep = key.indexOf(" ");
    return { scope: key.slice(0, sep) as "mine" | "theirs", term: key.slice(sep + 1), count };
  });
  // issue every get at once — per-term sequential awaits are an event-loop round trip each
  const existingWords = await Promise.all(wordEntries.map((e) => words.get([e.scope, e.term])));
  wordEntries.forEach((e, i) => {
    const row = existingWords[i] ?? { scope: e.scope, term: e.term, count: 0 };
    row.count += e.count;
    void words.put(row);
    storeWrites++;
  });

  for (const posting of pending.searchIndex) {
    void searchIndex.put(posting);
    storeWrites++;
  }

  const sessions = tx.objectStore("sessions");
  for (const [date, delta] of pending.sessions) {
    const row = (await sessions.get(date)) ?? { date, buckets: emptyBuckets(delta.buckets.length), totalMs: 0 };
    row.buckets = delta.buckets.map((n, i) => n + (row.buckets[i] ?? 0));
    row.totalMs += delta.totalMs;
    await sessions.put(row);
    storeWrites++;
  }

  const emoji = tx.objectStore("emoji");
  for (const [key, delta] of pending.emoji) {
    const sep = key.indexOf(" ");
    const guildScope = key.slice(0, sep);
    const emojiId = key.slice(sep + 1);
    const row = (await emoji.get([guildScope, emojiId])) ?? { guildScope, emojiId, name: delta.name, count: 0 };
    row.count = clamp0(row.count + delta.count);
    row.name = delta.name;
    await emoji.put(row);
    storeWrites++;
  }

  const domains = tx.objectStore("domains");
  for (const [domain, delta] of pending.domains) {
    const row = (await domains.get(domain)) ?? { domain, count: 0, lastTs: delta.lastTs };
    row.count += delta.count;
    row.lastTs = Math.max(row.lastTs, delta.lastTs);
    await domains.put(row);
    storeWrites++;
  }

  const meta = tx.objectStore("meta");
  await meta.put(opts.now, "lastFlushTs");
  const headEntries = [...opts.heads.entries()].sort((a, b) => b[1].ts - a[1].ts).slice(0, MAX_PERSISTED_HEADS);
  await meta.put(headEntries, "channelHeads");
  if (opts.session !== undefined) await meta.put(opts.session, "sessionState");

  await tx.done;
  return { events: pending.events.length, stores: storeWrites };
}
