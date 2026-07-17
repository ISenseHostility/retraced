// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test } from "vitest";
import { openRetracedDb, type RetracedDatabase } from "../src/db/schema";
import { generateSyntheticEvents, runSynthetic, SYNTHETIC_OWN_ID } from "../src/dev/synthetic";

const END = Date.parse("2026-07-16T00:00:00.000Z");

let db: RetracedDatabase;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db = await openRetracedDb();
});

describe("synthetic generator", () => {
  test("is deterministic for a given seed", () => {
    const a = [...generateSyntheticEvents({ days: 3, seed: 42, endTs: END })];
    const b = [...generateSyntheticEvents({ days: 3, seed: 42, endTs: END })];
    expect(a.length).toBeGreaterThan(50);
    expect(a).toEqual(b);
    const c = [...generateSyntheticEvents({ days: 3, seed: 43, endTs: END })];
    expect(c).not.toEqual(a);
  });

  test("events are chronologically ordered", () => {
    const events = [...generateSyntheticEvents({ days: 5, seed: 1, endTs: END })];
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.ts).toBeGreaterThanOrEqual(events[i - 1]!.ts);
    }
  });

  // 15 days, not more: the words/searchIndex write path multiplies row counts, and
  // fake-indexeddb pays a macrotask per request — real IndexedDB and real 5-second
  // flush batches are unaffected.
  test("a 15-day run populates every rollup store through the real pipeline", { timeout: 30_000 }, async () => {
    const stats = await runSynthetic(db, { days: 15, seed: 7, endTs: END });
    expect(stats.events).toBeGreaterThan(400);

    expect(await db.count("daily")).toBeGreaterThan(25);
    expect(await db.count("hourly")).toBeGreaterThan(50);
    expect(await db.count("messages")).toBeGreaterThan(150);
    expect(await db.count("events")).toBe(stats.events);
    expect(await db.count("peers")).toBeGreaterThanOrEqual(6);
    expect(await db.count("voice")).toBeGreaterThan(2);
    expect(await db.count("sessions")).toBeGreaterThan(6);
    expect(await db.count("emoji")).toBeGreaterThan(2);
    expect(await db.count("domains")).toBeGreaterThan(1);
    expect(await db.count("words")).toBeGreaterThan(20);
    expect(await db.count("searchIndex")).toBeGreaterThan(200);

    // the flagship metric has data on both sides
    const dailies = await db.getAll("daily");
    const committed = dailies.reduce((n, d) => n + d.typingCommitted, 0);
    const aborted = dailies.reduce((n, d) => n + d.typingAborted, 0);
    expect(committed).toBeGreaterThan(30);
    expect(aborted).toBeGreaterThan(3);

    // reply latency histograms accumulated in both directions
    const peers = await db.getAll("peers");
    expect(peers.some((p) => p.latencyBucketsMine.some((n) => n > 0))).toBe(true);
    expect(peers.some((p) => p.latencyBucketsTheirs.some((n) => n > 0))).toBe(true);
  });

  test("CONTENT RULE INTEGRITY: no stored row ever violates the scoping rule", { timeout: 30_000 }, async () => {
    await runSynthetic(db, { days: 15, seed: 11, endTs: END });
    const messages = await db.getAll("messages");
    expect(messages.length).toBeGreaterThan(150);

    const violations = messages.filter((m) => !m.isOwn && m.guildId !== null && m.content !== null);
    expect(violations).toEqual([]);

    // and the ring buffer obeys the same rule
    const events = await db.getAll("events");
    const eventViolations = events.filter(
      (e) =>
        e.event.kind === "message-created" &&
        !e.event.isOwn &&
        e.event.channel.guildId !== null &&
        e.event.content !== null
    );
    expect(eventViolations).toEqual([]);

    // DM traffic from peers IS stored — both sides, per the spec
    expect(messages.some((m) => m.authorId !== SYNTHETIC_OWN_ID && m.guildId === null && m.content !== null)).toBe(true);

    // the search index obeys the same rule: nothing indexed for others' guild messages
    const postings = await db.getAll("searchIndex");
    expect(postings.length).toBeGreaterThan(200);
    const indexViolations = postings.filter((p) => !p.isOwn && p.guildId !== null);
    expect(indexViolations).toEqual([]);
    // and their-side postings DO exist for DMs
    expect(postings.some((p) => !p.isOwn && p.guildId === null)).toBe(true);
  });
});
