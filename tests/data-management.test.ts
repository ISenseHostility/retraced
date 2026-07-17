// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test } from "vitest";
import { PendingBuffer } from "../src/aggregate/pending";
import { createReducerContext, reduceEvent, type ReducerContext } from "../src/aggregate/reducers";
import type { ChannelRef, MessageCreatedEvent } from "../src/capture/types";
import { exportAll, importAll } from "../src/db/export";
import { flushPending } from "../src/db/flush";
import { searchMessages } from "../src/db/queries";
import { rebuildContentIndex, rebuildFromEvents } from "../src/db/rebuild";
import { openRetracedDb, type RetracedDatabase } from "../src/db/schema";
import { wipeAll, wipeContentOnly, wipeDateRange, wipePeer } from "../src/db/wipe";
import { dateKey } from "../src/util/time";

const ME = "100";
const PEER = "200";
const dm: ChannelRef = { channelId: "dm1", guildId: null, kind: "dm" };
const guild: ChannelRef = { channelId: "chan1", guildId: "g1", kind: "guild" };
const T0 = Date.parse("2026-07-16T12:00:00.000Z");
const D0 = dateKey(T0);
const DAY = 86_400_000;

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
    resolvePeerLabel: (id) => ({ label: `user-${id}`, avatarHash: null }),
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

async function seedBasics(): Promise<void> {
  reduceEvent(msg({ messageId: "own-dm", content: "quartz alpha" }), pending, ctx);
  reduceEvent(msg({ messageId: "their-dm", authorId: PEER, isOwn: false, content: "quartz reply" }), pending, ctx);
  reduceEvent(msg({ messageId: "own-guild", channel: guild, content: "quartz guild post" }), pending, ctx);
  reduceEvent(msg({ messageId: "their-guild", channel: guild, authorId: PEER, isOwn: false, content: null }), pending, ctx);
  await flush();
}

describe("export / import", () => {
  test("a full round-trip survives a wipe", async () => {
    await seedBasics();
    const envelope = await exportAll(db);
    expect(envelope.format).toBe("retraced-export");
    expect(envelope.version).toBeGreaterThanOrEqual(3);

    await wipeAll(db);
    expect(await db.count("messages")).toBe(0);

    const result = await importAll(db, envelope);
    expect(result.rows).toBeGreaterThan(10);
    expect(await db.count("messages")).toBe(4);
    expect((await db.get("daily", [D0, "dm1"]))!.sent).toBe(1);
    expect((await db.get("peers", PEER))!.label).toBe("user-200");
    expect(typeof (await db.get("meta", "installDate"))).toBe("number");
    // the search index came back too
    expect((await searchMessages(db, { query: "quartz " })).length).toBe(3);
  });

  test("import replaces what was there before", async () => {
    await seedBasics();
    const envelope = await exportAll(db);
    reduceEvent(msg({ messageId: "extra" }), pending, ctx);
    await flush();
    expect(await db.count("messages")).toBe(5);

    await importAll(db, envelope);
    expect(await db.count("messages")).toBe(4);
    expect(await db.get("messages", "extra")).toBeUndefined();
  });

  test("garbage is rejected before anything is touched", async () => {
    await seedBasics();
    await expect(importAll(db, { format: "nope" } as never)).rejects.toThrow();
    await expect(importAll(db, null as never)).rejects.toThrow();
    expect(await db.count("messages")).toBe(4);
  });
});

describe("wipeContentOnly", () => {
  test("drops text everywhere but keeps every rollup", async () => {
    await seedBasics();
    await wipeContentOnly(db);

    expect(await db.count("messages")).toBe(0);
    expect(await db.count("searchIndex")).toBe(0);
    expect(await db.count("words")).toBe(0);
    // the rebuild log keeps its events, but their text is gone
    const events = await db.getAll("events");
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect((e.event as { content?: string | null }).content ?? null).toBeNull();
    }
    // rollups survive — every chart except the content-level ones keeps working
    expect((await db.get("daily", [D0, "dm1"]))!.sent).toBe(1);
    expect((await db.get("daily", [D0, "dm1"]))!.theirSent).toBe(1);
    expect(await db.count("peers")).toBe(1);
    expect(await db.count("hourly")).toBeGreaterThan(0);
  });
});

describe("wipePeer", () => {
  test("removes the peer row, their messages, their postings, and their events", async () => {
    await seedBasics();
    await wipePeer(db, PEER);

    expect(await db.get("peers", PEER)).toBeUndefined();
    expect(await db.get("messages", "their-dm")).toBeUndefined();
    expect(await db.get("messages", "own-dm")).toBeDefined();
    expect(await searchMessages(db, { query: "reply " })).toEqual([]);
    // their message events are gone from the rebuild log; mine remain
    const events = await db.getAll("events");
    expect(events.some((e) => e.event.kind === "message-created" && e.event.authorId === PEER)).toBe(false);
    expect(events.some((e) => e.event.kind === "message-created" && e.event.authorId === ME)).toBe(true);
  });
});

describe("wipeDateRange", () => {
  test("removes date-scoped data inside the range and nothing outside", async () => {
    reduceEvent(msg({ messageId: "old", ts: T0 - 10 * DAY, content: "ancient scroll" }), pending, ctx);
    reduceEvent(msg({ messageId: "recent", ts: T0, content: "fresh scroll" }), pending, ctx);
    await flush();

    await wipeDateRange(db, T0 - 15 * DAY, T0 - 5 * DAY);

    expect(await db.get("messages", "old")).toBeUndefined();
    expect(await db.get("messages", "recent")).toBeDefined();
    expect(await db.get("daily", [dateKey(T0 - 10 * DAY), "dm1"])).toBeUndefined();
    expect((await db.get("daily", [D0, "dm1"]))!.sent).toBe(1);
    expect(await searchMessages(db, { query: "ancient " })).toEqual([]);
    expect((await searchMessages(db, { query: "fresh " })).length).toBe(1);
    const events = await db.getAll("events");
    expect(events.every((e) => e.ts >= T0 - 5 * DAY || e.ts <= T0 - 15 * DAY)).toBe(true);
  });
});

describe("rebuildFromEvents", () => {
  test("restores tampered date-scoped rollups from the ring buffer", async () => {
    await seedBasics();
    reduceEvent({ kind: "message-deleted", ts: T0 + 60_000, channelId: "dm1", guildId: null, messageId: "own-dm" }, pending, ctx);
    await flush();

    // sabotage
    const row = (await db.get("daily", [D0, "dm1"]))!;
    row.sent = 999;
    row.deleted = 0;
    await db.put("daily", row);

    const result = await rebuildFromEvents(db, { conversationGapMinutes: 30 });
    expect(result.events).toBeGreaterThan(0);

    const rebuilt = (await db.get("daily", [D0, "dm1"]))!;
    expect(rebuilt.sent).toBe(1);
    expect(rebuilt.theirSent).toBe(1);
    expect(rebuilt.deleted).toBe(1); // re-derived from the messages store
    // non-date-scoped aggregates are left alone
    expect((await db.get("peers", PEER))!.label).toBe("user-200");
  });
});

describe("rebuildContentIndex", () => {
  test("rebuilds words and search from stored messages, content rule intact", async () => {
    await seedBasics();
    // simulate a pre-index install: content stores empty, messages present
    const tx = db.transaction(["words", "searchIndex"], "readwrite");
    void tx.objectStore("words").clear();
    void tx.objectStore("searchIndex").clear();
    await tx.done;
    expect(await searchMessages(db, { query: "quartz " })).toEqual([]);

    const result = await rebuildContentIndex(db);
    expect(result.messages).toBe(3); // the null-content guild row contributes nothing

    expect((await searchMessages(db, { query: "quartz " })).length).toBe(3);
    expect((await db.get("words", ["mine", "quartz"]))!.count).toBe(2);
    expect((await db.get("words", ["theirs", "quartz"]))!.count).toBe(1);
    const postings = await db.getAll("searchIndex");
    expect(postings.some((p) => p.messageId === "their-guild")).toBe(false);
  });
});
