// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test } from "vitest";
import { LENGTH_BUCKET_BOUNDS_CHARS, bucketIndex } from "../src/aggregate/buckets";
import { PendingBuffer } from "../src/aggregate/pending";
import { createReducerContext, reduceEvent, type ReducerContext } from "../src/aggregate/reducers";
import type { ChannelRef, MessageCreatedEvent } from "../src/capture/types";
import { flushPending } from "../src/db/flush";
import { pruneMessages } from "../src/db/prune";
import { getTopTerms, searchMessages } from "../src/db/queries";
import { openRetracedDb, type RetracedDatabase } from "../src/db/schema";

/**
 * Phase 6 write path: the words rollup and the inverted search index. Both are
 * derived from CONTENT, so the content rule and the kill switch govern them:
 * own messages everywhere, both sides of DMs, never other people's guild text.
 */

const ME = "100";
const PEER = "200";
const dm: ChannelRef = { channelId: "dm1", guildId: null, kind: "dm" };
const guild: ChannelRef = { channelId: "chan1", guildId: "g1", kind: "guild" };
const T0 = Date.parse("2026-07-16T12:00:00.000Z");

let db: RetracedDatabase;
let pending: PendingBuffer;
let ctx: ReducerContext;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db = await openRetracedDb();
  pending = new PendingBuffer();
  ctx = createReducerContext({
    ownUserId: ME,
    settings: () => ({ conversationGapMinutes: 30 }),
    resolvePeerLabel: () => null,
    dmRecipients: (id) => (id === "dm1" ? [PEER] : null),
  });
});

let nextId = 0;
function msg(over: Partial<MessageCreatedEvent> = {}): MessageCreatedEvent {
  return {
    kind: "message-created",
    ts: T0 + nextId * 1000,
    channel: dm,
    messageId: `m${nextId++}`,
    authorId: ME,
    isOwn: true,
    content: "hello world",
    chars: 11,
    words: 2,
    contentTypes: { text: true, image: false, link: false, gif: false, sticker: false, attachment: false },
    replyToId: null,
    replyToAuthorId: null,
    replyToTs: null,
    customEmoji: [],
    domains: [],
    ...over,
  };
}

async function flush(): Promise<void> {
  await flushPending(db, pending, { now: T0, heads: ctx.heads, session: ctx.session });
  pending = new PendingBuffer();
}

describe("schema v3", () => {
  test("words and searchIndex stores exist", () => {
    expect(db.objectStoreNames.contains("words")).toBe(true);
    expect(db.objectStoreNames.contains("searchIndex")).toBe(true);
  });
});

describe("words rollup", () => {
  test("own words count everywhere; their words only in DMs; guild others never", async () => {
    reduceEvent(msg({ channel: guild, content: "alpha beta" }), pending, ctx);
    reduceEvent(msg({ content: "alpha gamma" }), pending, ctx);
    reduceEvent(msg({ authorId: PEER, isOwn: false, content: "delta alpha" }), pending, ctx);
    reduceEvent(msg({ channel: guild, authorId: PEER, isOwn: false, content: null, chars: 11, words: 2 }), pending, ctx);
    await flush();

    expect((await db.get("words", ["mine", "alpha"]))!.count).toBe(2);
    expect((await db.get("words", ["mine", "beta"]))!.count).toBe(1);
    expect((await db.get("words", ["theirs", "delta"]))!.count).toBe(1);
    expect((await db.get("words", ["theirs", "alpha"]))!.count).toBe(1);
    // bigrams live in the same store, distinguished by the space
    expect((await db.get("words", ["mine", "alpha beta"]))!.count).toBe(1);
  });

  test("getTopTerms walks the count index descending with a skip filter", async () => {
    reduceEvent(msg({ content: "spam spam spam eggs eggs ham" }), pending, ctx);
    await flush();
    const top = await getTopTerms(db, "mine", { kind: "word", limit: 2 });
    expect(top).toEqual([
      { term: "spam", count: 3 },
      { term: "eggs", count: 2 },
    ]);
    const skipped = await getTopTerms(db, "mine", { kind: "word", limit: 2, skip: (t) => t === "spam" });
    expect(skipped[0]).toEqual({ term: "eggs", count: 2 });
    const phrases = await getTopTerms(db, "mine", { kind: "phrase", limit: 1 });
    expect(phrases[0]).toEqual({ term: "spam spam", count: 2 });
  });
});

describe("daily theirs-side + length buckets", () => {
  test("their DM messages roll up sent/chars/words and length buckets", async () => {
    reduceEvent(msg({ authorId: PEER, isOwn: false, content: "one two three", chars: 13, words: 3 }), pending, ctx);
    reduceEvent(msg({ content: "mine", chars: 4, words: 1 }), pending, ctx);
    await flush();

    const row = (await db.get("daily", ["2026-07-16", "dm1"]))!;
    expect(row.theirSent).toBe(1);
    expect(row.theirChars).toBe(13);
    expect(row.theirWords).toBe(3);
    expect(row.theirUniqueWords).toBe(3);
    expect(row.lengthBuckets![bucketIndex(4, LENGTH_BUCKET_BOUNDS_CHARS)]).toBe(1);
    expect(row.theirLengthBuckets![bucketIndex(13, LENGTH_BUCKET_BOUNDS_CHARS)]).toBe(1);
  });

  test("their guild messages contribute nothing to theirs-side text stats", async () => {
    reduceEvent(msg({ channel: guild, authorId: PEER, isOwn: false, content: null, chars: 13, words: 3 }), pending, ctx);
    await flush();
    const row = (await db.get("daily", ["2026-07-16", "chan1"]))!;
    expect(row.theirSent ?? 0).toBe(0);
    expect(row.theirWords ?? 0).toBe(0);
  });
});

describe("search index", () => {
  test("CONTENT RULE: indexes own + DM text, never other people's guild messages", async () => {
    reduceEvent(msg({ messageId: "own-guild", channel: guild, content: "quartz unique" }), pending, ctx);
    reduceEvent(msg({ messageId: "their-dm", authorId: PEER, isOwn: false, content: "quartz reply" }), pending, ctx);
    reduceEvent(msg({ messageId: "their-guild", channel: guild, authorId: PEER, isOwn: false, content: null }), pending, ctx);
    await flush();

    const postings = await db.getAll("searchIndex");
    expect(postings.some((p) => p.messageId === "their-guild")).toBe(false);
    const quartz = postings.filter((p) => p.term === "quartz");
    expect(quartz.map((p) => p.messageId).sort()).toEqual(["own-guild", "their-dm"]);
  });

  test("searchMessages intersects terms and returns newest first", async () => {
    reduceEvent(msg({ messageId: "a", content: "red apple pie", ts: T0 }), pending, ctx);
    reduceEvent(msg({ messageId: "b", content: "red brick wall", ts: T0 + 1000 }), pending, ctx);
    reduceEvent(msg({ messageId: "c", content: "green apple tart", ts: T0 + 2000 }), pending, ctx);
    await flush();

    const red = await searchMessages(db, { query: "red " });
    expect(red.map((m) => m.messageId)).toEqual(["b", "a"]);
    const redApple = await searchMessages(db, { query: "red apple " });
    expect(redApple.map((m) => m.messageId)).toEqual(["a"]);
  });

  test("the trailing term matches as a prefix while typing", async () => {
    reduceEvent(msg({ messageId: "a", content: "remarkable thing" }), pending, ctx);
    await flush();
    expect((await searchMessages(db, { query: "remark" })).map((m) => m.messageId)).toEqual(["a"]);
    expect(await searchMessages(db, { query: "remark " })).toEqual([]); // trailing space = exact word
  });

  test("scoping by channel and time window", async () => {
    reduceEvent(msg({ messageId: "a", content: "topic here", ts: T0 }), pending, ctx);
    reduceEvent(msg({ messageId: "b", channel: guild, content: "topic there", ts: T0 + 5000 }), pending, ctx);
    await flush();

    expect((await searchMessages(db, { query: "topic ", channelId: "chan1" })).map((m) => m.messageId)).toEqual(["b"]);
    expect((await searchMessages(db, { query: "topic ", toTs: T0 + 1000 })).map((m) => m.messageId)).toEqual(["a"]);
    expect((await searchMessages(db, { query: "topic ", fromTs: T0 + 1000 })).map((m) => m.messageId)).toEqual(["b"]);
  });

  test("pruning old messages removes their postings too", async () => {
    reduceEvent(msg({ messageId: "old", content: "ancient scroll", ts: T0 - 100 * 86_400_000 }), pending, ctx);
    reduceEvent(msg({ messageId: "new", content: "fresh scroll", ts: T0 }), pending, ctx);
    await flush();

    await pruneMessages(db, T0 - 30 * 86_400_000);
    expect(await searchMessages(db, { query: "ancient " })).toEqual([]);
    expect((await db.getAll("searchIndex")).some((p) => p.messageId === "old")).toBe(false);
    expect((await searchMessages(db, { query: "scroll " })).map((m) => m.messageId)).toEqual(["new"]);
  });

  test("edits reindex: stale terms drop out, new terms search", async () => {
    reduceEvent(msg({ messageId: "a", content: "original wording" }), pending, ctx);
    await flush();
    reduceEvent(
      {
        kind: "message-edited",
        ts: T0 + 60_000,
        channel: dm,
        messageId: "a",
        authorId: ME,
        isOwn: true,
        content: "revised wording",
        editLatencyMs: 60_000,
      },
      pending,
      ctx
    );
    await flush();

    expect(await searchMessages(db, { query: "original " })).toEqual([]);
    expect((await searchMessages(db, { query: "revised " })).map((m) => m.messageId)).toEqual(["a"]);
    expect((await searchMessages(db, { query: "wording " })).map((m) => m.messageId)).toEqual(["a"]);
  });
});
