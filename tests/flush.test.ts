// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test } from "vitest";
import { PendingBuffer } from "../src/aggregate/pending";
import { createReducerContext, reduceEvent, type ReducerContext } from "../src/aggregate/reducers";
import type { ChannelRef, MessageCreatedEvent } from "../src/capture/types";
import { flushPending } from "../src/db/flush";
import { pruneEvents, pruneMessages } from "../src/db/prune";
import { ALL_STORES, openRetracedDb, type RetracedDatabase } from "../src/db/schema";
import { dateKey } from "../src/util/time";

const ME = "100";
const PEER = "200";
const dm: ChannelRef = { channelId: "dm1", guildId: null, kind: "dm" };
const guild: ChannelRef = { channelId: "chan1", guildId: "g1", kind: "guild" };
const T0 = Date.parse("2026-07-16T12:00:00.000Z");
const D0 = dateKey(T0);

let db: RetracedDatabase;
let pending: PendingBuffer;
let ctx: ReducerContext;

beforeEach(async () => {
  // a fresh IndexedDB universe per test
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

function msg(over: Partial<MessageCreatedEvent> = {}): MessageCreatedEvent {
  return {
    kind: "message-created",
    ts: T0,
    channel: dm,
    messageId: "m1",
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

async function reduceAndFlush(events: Parameters<typeof reduceEvent>[0][]): Promise<void> {
  for (const ev of events) reduceEvent(ev, pending, ctx);
  await flushPending(db, pending, { now: T0 + 60_000, heads: ctx.heads });
  pending = new PendingBuffer();
}

describe("schema", () => {
  test("all nine stores exist and installDate is set once", async () => {
    for (const store of ALL_STORES) expect(db.objectStoreNames.contains(store)).toBe(true);
    const install = await db.get("meta", "installDate");
    expect(typeof install).toBe("number");
  });
});

describe("flushPending", () => {
  test("message rows land with the content rule intact", async () => {
    await reduceAndFlush([
      msg({ messageId: "own-dm" }),
      msg({ messageId: "their-dm", authorId: PEER, isOwn: false }),
      msg({ messageId: "own-guild", channel: guild }),
      msg({ messageId: "their-guild", channel: guild, authorId: PEER, isOwn: false, content: null }),
    ]);
    expect((await db.get("messages", "own-dm"))!.content).toBe("hello world");
    expect((await db.get("messages", "their-dm"))!.content).toBe("hello world");
    expect((await db.get("messages", "own-guild"))!.content).toBe("hello world");
    expect((await db.get("messages", "their-guild"))!.content).toBeNull();
  });

  test("daily rows merge across flushes", async () => {
    await reduceAndFlush([msg({ messageId: "a" })]);
    await reduceAndFlush([msg({ messageId: "b", ts: T0 + 1000 })]);
    const row = (await db.get("daily", [D0, "dm1"]))!;
    expect(row.sent).toBe(2);
    expect(row.chars).toBe(22);
    expect(row.initiatedByMe).toBe(1); // heads persisted across flushes — second message is no initiation
    expect(row.longestBurst).toBe(2); // burst state also survives the flush boundary
  });

  test("longestBurst merges as a max, never a sum", async () => {
    await reduceAndFlush([msg({ messageId: "a" }), msg({ messageId: "b", ts: T0 + 1000 }), msg({ messageId: "c", ts: T0 + 2000 })]);
    // later flush, same day: a fresh conversation reaching only 1
    await reduceAndFlush([msg({ messageId: "d", ts: T0 + 2 * 3_600_000 })]);
    expect((await db.get("daily", [D0, "dm1"]))!.longestBurst).toBe(3);
  });

  test("edits merge revisions and bump counters on the stored row", async () => {
    await reduceAndFlush([msg()]);
    await reduceAndFlush([
      {
        kind: "message-edited",
        ts: T0 + 30_000,
        channel: dm,
        messageId: "m1",
        authorId: ME,
        isOwn: true,
        content: "hello world edited",
        editLatencyMs: 30_000,
      },
    ]);
    const row = (await db.get("messages", "m1"))!;
    expect(row.content).toBe("hello world edited");
    expect(row.revisions).toEqual([{ ts: T0, content: "hello world" }]);
    expect(row.editCount).toBe(1);
    expect(row.lastEditedTs).toBe(T0 + 30_000);
    expect((await db.get("daily", [D0, "dm1"]))!.edited).toBe(1);
  });

  test("edits to unstorable rows never add content or revisions", async () => {
    await reduceAndFlush([msg({ messageId: "g1msg", channel: guild, authorId: PEER, isOwn: false, content: null })]);
    await reduceAndFlush([
      {
        kind: "message-edited",
        ts: T0 + 5_000,
        channel: guild,
        messageId: "g1msg",
        authorId: PEER,
        isOwn: false,
        content: null,
        editLatencyMs: 5_000,
      },
    ]);
    const row = (await db.get("messages", "g1msg"))!;
    expect(row.content).toBeNull();
    expect(row.revisions).toEqual([]);
    expect(row.editCount).toBe(1);
  });

  test("deleting an own message tombstones the row and bumps daily with a lifetime bucket", async () => {
    await reduceAndFlush([msg()]);
    await reduceAndFlush([{ kind: "message-deleted", ts: T0 + 30_000, channelId: "dm1", guildId: null, messageId: "m1" }]);
    const row = (await db.get("messages", "m1"))!;
    expect(row.deletedAt).toBe(T0 + 30_000);
    expect(row.deleteAfterMs).toBe(30_000);
    expect(row.content).toBe("hello world"); // last known content retained (storable)
    const daily = (await db.get("daily", [dateKey(T0 + 30_000), "dm1"]))!;
    expect(daily.deleted).toBe(1);
    expect(daily.deleteAfterBuckets).toEqual([0, 1, 0, 0, 0, 0, 0]); // 30s → 10–60s bucket
  });

  test("deleting someone else's message tombstones but does not bump own daily.deleted", async () => {
    await reduceAndFlush([msg({ authorId: PEER, isOwn: false })]);
    await reduceAndFlush([{ kind: "message-deleted", ts: T0 + 5_000, channelId: "dm1", guildId: null, messageId: "m1" }]);
    expect((await db.get("messages", "m1"))!.deletedAt).toBe(T0 + 5_000);
    expect((await db.get("daily", [D0, "dm1"]))?.deleted ?? 0).toBe(0);
  });

  test("deleting an unknown message is a no-op", async () => {
    await reduceAndFlush([{ kind: "message-deleted", ts: T0, channelId: "dm1", guildId: null, messageId: "ghost" }]);
    expect(await db.count("messages")).toBe(0);
  });

  test("create, edit and delete inside one flush batch resolve in order", async () => {
    await reduceAndFlush([
      msg(),
      { kind: "message-edited", ts: T0 + 1_000, channel: dm, messageId: "m1", authorId: ME, isOwn: true, content: "v2", editLatencyMs: 1_000 },
      { kind: "message-deleted", ts: T0 + 2_000, channelId: "dm1", guildId: null, messageId: "m1" },
    ]);
    const row = (await db.get("messages", "m1"))!;
    expect(row.content).toBe("v2");
    expect(row.revisions).toEqual([{ ts: T0, content: "hello world" }]);
    expect(row.deletedAt).toBe(T0 + 2_000);
    const daily = (await db.get("daily", [D0, "dm1"]))!;
    expect(daily.deleted).toBe(1);
    expect(daily.edited).toBe(1);
  });

  test("peers, hourly, emoji, domains and voice all persist and merge", async () => {
    await reduceAndFlush([
      msg({ messageId: "p1", authorId: PEER, isOwn: false }),
      msg({ messageId: "p2", ts: T0 + 10_000, customEmoji: [{ id: "e1", name: "pog" }], domains: ["example.com"] }),
      { kind: "voice-segment", ts: T0, channel: guild, seconds: 120, coPresent: { [PEER]: 60 } },
    ]);
    await reduceAndFlush([
      msg({ messageId: "p3", ts: T0 + 20_000, customEmoji: [{ id: "e1", name: "pog" }], domains: ["example.com"] }),
      { kind: "voice-segment", ts: T0 + 400_000, channel: guild, seconds: 60, coPresent: { [PEER]: 60 } },
    ]);

    const peerRow = (await db.get("peers", PEER))!;
    expect(peerRow.msgFromThem).toBe(1);
    expect(peerRow.latencyBucketsMine).toHaveLength(7);
    expect(peerRow.latencyBucketsMine[1]).toBe(1); // my 10s reply to their message

    expect((await db.get("hourly", [D0, new Date(T0).getHours()]))!.sent).toBe(2);
    expect((await db.get("emoji", ["dm", "e1"]))!.count).toBe(2);
    expect((await db.get("domains", "example.com"))!.count).toBe(2);
    expect((await db.get("voice", [D0, "chan1"]))!.seconds).toBe(180);
    expect((await db.get("voice", [D0, "chan1"]))!.coPresent[PEER]).toBe(120);
  });

  test("reaction removals cannot drive counters below zero", async () => {
    await reduceAndFlush([
      {
        kind: "reaction",
        ts: T0,
        channel: dm,
        direction: -1,
        actorId: ME,
        actorIsOwn: true,
        messageId: "mx",
        messageAuthorId: PEER,
        messageAuthorIsOwn: false,
        emoji: { id: null, name: "👍" },
      },
    ]);
    expect((await db.get("daily", [D0, "dm1"]))!.reactionsGiven).toBe(0);
    expect((await db.get("peers", PEER))!.reactionsToThem).toBe(0);
  });

  test("every event lands in the ring buffer and meta records the flush", async () => {
    await reduceAndFlush([msg(), msg({ messageId: "m2", ts: T0 + 1000 })]);
    expect(await db.count("events")).toBe(2);
    expect(await db.get("meta", "lastFlushTs")).toBe(T0 + 60_000);
    const heads = (await db.get("meta", "channelHeads")) as Array<[string, { ts: number }]>;
    expect(heads.find(([id]) => id === "dm1")![1].ts).toBe(T0 + 1000);
  });

  test("an empty buffer flush writes nothing", async () => {
    const result = await flushPending(db, new PendingBuffer(), { now: T0, heads: new Map() });
    expect(result.events).toBe(0);
    expect(await db.get("meta", "lastFlushTs")).toBeUndefined();
  });
});

describe("pruning", () => {
  test("events older than the cutoff are removed, newer kept", async () => {
    await reduceAndFlush([msg(), msg({ messageId: "m2", ts: T0 + 100_000 })]);
    const removed = await pruneEvents(db, T0 + 50_000);
    expect(removed).toBe(1);
    expect(await db.count("events")).toBe(1);
  });

  test("message pruning respects the cutoff", async () => {
    await reduceAndFlush([msg(), msg({ messageId: "m2", ts: T0 + 100_000 })]);
    const removed = await pruneMessages(db, T0 + 50_000);
    expect(removed).toBe(1);
    expect(await db.get("messages", "m2")).toBeDefined();
    expect(await db.get("messages", "m1")).toBeUndefined();
  });
});
