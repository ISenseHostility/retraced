// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, test } from "vitest";
import { SESSION_BUCKET_BOUNDS_MS, SESSION_BUCKET_COUNT, bucketIndex } from "../src/aggregate/buckets";
import { PendingBuffer } from "../src/aggregate/pending";
import { SESSION_GAP_MS, createReducerContext, reduceEvent, type ReducerContext } from "../src/aggregate/reducers";
import type { ChannelRef, MessageCreatedEvent } from "../src/capture/types";
import { flushPending } from "../src/db/flush";
import { getSessionRange } from "../src/db/queries";
import { DB_NAME, openRetracedDb, type RetracedDatabase } from "../src/db/schema";
import { dateKey } from "../src/util/time";

/**
 * Sessions: gap-bounded runs of the user's OWN messages, across all channels.
 * Rolled up as a per-day duration histogram (spec §5 Rhythm: "session length
 * distribution") — the day is the one the session STARTED on.
 */

const ME = "100";
const PEER = "200";
const dm: ChannelRef = { channelId: "dm1", guildId: null, kind: "dm" };
const guild: ChannelRef = { channelId: "chan1", guildId: "g1", kind: "guild" };
const T0 = Date.parse("2026-07-16T12:00:00.000Z");
const D0 = dateKey(T0);
const MIN = 60_000;

let pending: PendingBuffer;
let ctx: ReducerContext;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
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
    messageId: `m${over.ts ?? T0}-${over.authorId ?? ME}`,
    authorId: ME,
    isOwn: true,
    content: "hello",
    chars: 5,
    words: 1,
    contentTypes: { text: true, image: false, link: false, gif: false, sticker: false, attachment: false },
    replyToId: null,
    replyToAuthorId: null,
    replyToTs: null,
    customEmoji: [],
    domains: [],
    ...over,
  };
}

describe("session tracking in the reducer", () => {
  test("an own message opens a session; more within the gap extend it without emitting", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 10 * MIN }), pending, ctx);
    expect(ctx.session).toEqual({ startTs: T0, lastTs: T0 + 10 * MIN });
    expect(pending.sessions.size).toBe(0);
  });

  test("a gap beyond SESSION_GAP_MS resolves the run into the start day's histogram", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 10 * MIN }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 10 * MIN + SESSION_GAP_MS + 1 }), pending, ctx);

    const delta = pending.sessions.get(D0)!;
    expect(delta.totalMs).toBe(10 * MIN);
    const expected = new Array(SESSION_BUCKET_COUNT).fill(0);
    expected[bucketIndex(10 * MIN, SESSION_BUCKET_BOUNDS_MS)] = 1;
    expect(delta.buckets).toEqual(expected);
    // and a new session opened at the resolving message
    expect(ctx.session).toEqual({ startTs: T0 + 10 * MIN + SESSION_GAP_MS + 1, lastTs: T0 + 10 * MIN + SESSION_GAP_MS + 1 });
  });

  test("sessions span channels — dm then guild is one run", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 5 * MIN, channel: guild }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 5 * MIN + SESSION_GAP_MS + 1 }), pending, ctx);
    expect(pending.sessions.get(D0)!.totalMs).toBe(5 * MIN);
  });

  test("other people's messages neither open nor extend a session", () => {
    reduceEvent(msg({ authorId: PEER, isOwn: false }), pending, ctx);
    expect(ctx.session).toBeNull();

    reduceEvent(msg({ ts: T0 + 1 * MIN }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 10 * MIN, authorId: PEER, isOwn: false }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1 * MIN + SESSION_GAP_MS + 1 }), pending, ctx);
    // the peer's message at +10min did not extend, so the session was the single message at +1min
    expect(pending.sessions.get(D0)!.totalMs).toBe(0);
  });

  test("a single-message session lands in the shortest bucket with zero duration", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + SESSION_GAP_MS + 1 }), pending, ctx);
    const delta = pending.sessions.get(D0)!;
    expect(delta.buckets[0]).toBe(1);
    expect(delta.totalMs).toBe(0);
  });

  test("non-message events do not extend a session", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(
      { kind: "typing-resolved", ts: T0 + 10 * MIN, channel: dm, startedAt: T0 + 9 * MIN, durationMs: MIN, committed: false, peerId: PEER },
      pending,
      ctx
    );
    expect(ctx.session).toEqual({ startTs: T0, lastTs: T0 });
  });
});

describe("sessions store (schema v2) and flush", () => {
  let db: RetracedDatabase;

  beforeEach(async () => {
    db = await openRetracedDb();
  });

  test("the sessions store exists", () => {
    expect(db.objectStoreNames.contains("sessions")).toBe(true);
  });

  test("session deltas merge additively across flushes", async () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 10 * MIN }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 10 * MIN + SESSION_GAP_MS + 1 }), pending, ctx);
    await flushPending(db, pending, { now: T0, heads: ctx.heads, session: ctx.session });

    pending = new PendingBuffer();
    reduceEvent(msg({ ts: T0 + 2 * SESSION_GAP_MS + 20 * MIN }), pending, ctx);
    await flushPending(db, pending, { now: T0, heads: ctx.heads, session: ctx.session });

    const row = (await db.get("sessions", D0))!;
    expect(row.totalMs).toBe(10 * MIN);
    expect(row.buckets.reduce((a: number, b: number) => a + b, 0)).toBe(2); // 10min run + the single-message run
  });

  test("open-session state round-trips through meta", async () => {
    reduceEvent(msg(), pending, ctx);
    await flushPending(db, pending, { now: T0, heads: ctx.heads, session: ctx.session });
    expect(await db.get("meta", "sessionState")).toEqual({ startTs: T0, lastTs: T0 });
  });

  test("a v1 database upgrades in place, keeping its data", async () => {
    db.close();
    // fresh universe with a minimal v1 database holding a marker
    globalThis.indexedDB = new IDBFactory();
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(database) {
        database.createObjectStore("meta");
      },
    });
    await v1.put("meta", "kept", "marker");
    v1.close();

    const upgraded = await openRetracedDb();
    expect(upgraded.objectStoreNames.contains("sessions")).toBe(true);
    expect(await upgraded.get("meta", "marker")).toBe("kept");
    upgraded.close();
  });
});

describe("getSessionRange", () => {
  test("returns only rows inside the date bound", async () => {
    const db = await openRetracedDb();
    for (const date of ["2026-07-01", "2026-07-10", "2026-07-20"]) {
      await db.put("sessions", { date, buckets: new Array(SESSION_BUCKET_COUNT).fill(0), totalMs: 0 });
    }
    const rows = await getSessionRange(db, "2026-07-05", "2026-07-15");
    expect(rows.map((r) => r.date)).toEqual(["2026-07-10"]);
    const all = await getSessionRange(db, null, "2026-12-31");
    expect(all).toHaveLength(3);
  });
});
