import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CapturedEvent, ContentTypeFlags } from "../capture/types";

/**
 * IndexedDB layout (spec §4). Rollup stores are the ONLY render path for
 * charts; `events` is a rebuild-only ring buffer; `messages` is content at
 * rest, already scoped by the content rule before it gets here.
 *
 * Scoping conventions, chosen so every chart reads one store:
 *  - `daily`/`hourly` count the user's OWN activity (plus the explicitly
 *    two-sided fields: initiatedByMe/Them, reactionsGiven/Received, dwellMs).
 *  - `peers` message/initiation counters are 1:1 DM scoped; msgFromThem also
 *    counts group-DM authors. Latency and reactions accrue from any channel.
 *  - `emoji` counts the user's own usage, keyed by usage scope (guildId | "dm").
 *  - `domains` counts links seen in captured messages (all authors — counts
 *    are rollup-legal under the content rule; no text is retained).
 */

export interface EventRow {
  id?: number;
  ts: number;
  event: CapturedEvent;
}

export interface MessageRow {
  messageId: string;
  ts: number;
  channelId: string;
  guildId: string | null;
  authorId: string;
  isOwn: boolean;
  /** null ⇔ not storable under the content rule (never an empty-string marker) */
  content: string | null;
  /** prior contents, oldest first; only ever populated where content is storable */
  revisions: Array<{ ts: number; content: string }>;
  deletedAt: number | null;
  deleteAfterMs: number | null;
  editCount: number;
  lastEditedTs: number | null;
  replyToId: string | null;
  contentTypes: ContentTypeFlags;
  chars: number;
  words: number;
}

export interface DailyRow {
  date: string;
  channelId: string;
  guildId: string | null;
  sent: number;
  edited: number;
  deleted: number;
  chars: number;
  words: number;
  uniqueWords: number;
  typingCommitted: number;
  typingAborted: number;
  typingMs: number;
  dwellMs: number;
  reactionsGiven: number;
  reactionsReceived: number;
  contentTypes: Record<keyof ContentTypeFlags, number>;
  initiatedByMe: number;
  initiatedByThem: number;
  /** own deletions bucketed by message lifetime — see DELETE_BUCKET_BOUNDS_MS */
  deleteAfterBuckets: number[];
  /** longest conversation (both sides, gap-bounded) that ended on this day+channel */
  longestBurst: number;
  // ---- theirs-side text stats (DM/group-DM only — the content rule's storable side)
  // and length histograms, both sides. Optional: rows written before Phase 6 lack them.
  theirSent?: number;
  theirChars?: number;
  theirWords?: number;
  theirUniqueWords?: number;
  /** own message lengths — see LENGTH_BUCKET_BOUNDS_CHARS */
  lengthBuckets?: number[];
  theirLengthBuckets?: number[];
}

export interface HourlyRow {
  date: string;
  hour: number;
  sent: number;
}

export interface PeerRow {
  userId: string;
  label: string | null;
  avatarHash: string | null;
  msgToThem: number;
  msgFromThem: number;
  initiatedByMe: number;
  initiatedByThem: number;
  latencyBucketsMine: number[];
  latencyBucketsTheirs: number[];
  typingAbortedAtThem: number;
  reactionsToThem: number;
  reactionsFromThem: number;
  firstSeenTs: number;
  lastSeenTs: number;
}

export interface VoiceRow {
  date: string;
  channelId: string;
  guildId: string | null;
  seconds: number;
  coPresent: Record<string, number>;
}

export interface SessionRow {
  /** the local day the session STARTED on */
  date: string;
  /** duration histogram — see SESSION_BUCKET_BOUNDS_MS */
  buckets: number[];
  totalMs: number;
}

export interface EmojiRow {
  guildScope: string;
  emojiId: string;
  name: string;
  count: number;
}

export interface DomainRow {
  domain: string;
  count: number;
  lastTs: number;
}

/** One term (word, or space-joined bigram "phrase") per side of the content rule. */
export interface WordRow {
  scope: "mine" | "theirs";
  term: string;
  count: number;
}

/**
 * Inverted-index posting: term → message. Only content-storable messages are
 * ever indexed, so the content rule scopes search automatically.
 */
export interface SearchPosting {
  term: string;
  messageId: string;
  ts: number;
  channelId: string;
  guildId: string | null;
  isOwn: boolean;
}

export interface RetracedDb extends DBSchema {
  meta: { key: string; value: unknown };
  events: { key: number; value: EventRow; indexes: { ts: number } };
  messages: { key: string; value: MessageRow; indexes: { ts: number; channelId: string; authorId: string } };
  daily: { key: [string, string]; value: DailyRow; indexes: { date: string; guildId: string } };
  hourly: { key: [string, number]; value: HourlyRow };
  peers: { key: string; value: PeerRow };
  voice: { key: [string, string]; value: VoiceRow };
  sessions: { key: string; value: SessionRow };
  emoji: { key: [string, string]; value: EmojiRow };
  domains: { key: string; value: DomainRow };
  words: { key: [string, string]; value: WordRow; indexes: { byCount: [string, number] } };
  searchIndex: { key: [string, string]; value: SearchPosting };
}

export type RetracedDatabase = IDBPDatabase<RetracedDb>;

export const DB_NAME = "retraced";
export const DB_VERSION = 3;

export const ALL_STORES = [
  "meta",
  "events",
  "messages",
  "daily",
  "hourly",
  "peers",
  "voice",
  "sessions",
  "emoji",
  "domains",
  "words",
  "searchIndex",
] as const;

export async function openRetracedDb(): Promise<RetracedDatabase> {
  const db = await openDB<RetracedDb>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      // Versioned migration path: each block advances one schema version.
      if (oldVersion < 1) {
        database.createObjectStore("meta");

        const events = database.createObjectStore("events", { keyPath: "id", autoIncrement: true });
        events.createIndex("ts", "ts");

        const messages = database.createObjectStore("messages", { keyPath: "messageId" });
        messages.createIndex("ts", "ts");
        messages.createIndex("channelId", "channelId");
        messages.createIndex("authorId", "authorId");

        const daily = database.createObjectStore("daily", { keyPath: ["date", "channelId"] });
        daily.createIndex("date", "date");
        daily.createIndex("guildId", "guildId");

        database.createObjectStore("hourly", { keyPath: ["date", "hour"] });
        database.createObjectStore("peers", { keyPath: "userId" });
        database.createObjectStore("voice", { keyPath: ["date", "channelId"] });
        database.createObjectStore("emoji", { keyPath: ["guildScope", "emojiId"] });
        database.createObjectStore("domains", { keyPath: "domain" });
      }
      if (oldVersion < 2) {
        // v2 (Phase 4): per-day usage-session duration histograms
        database.createObjectStore("sessions", { keyPath: "date" });
      }
      if (oldVersion < 3) {
        // v3 (Phase 6): word/phrase counts and the full-text inverted index
        const words = database.createObjectStore("words", { keyPath: ["scope", "term"] });
        words.createIndex("byCount", ["scope", "count"]);
        database.createObjectStore("searchIndex", { keyPath: ["term", "messageId"] });
      }
    },
  });

  if ((await db.get("meta", "installDate")) === undefined) {
    await db.put("meta", Date.now(), "installDate");
  }
  return db;
}
