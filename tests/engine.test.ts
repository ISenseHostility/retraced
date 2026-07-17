import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CaptureEngine, type CaptureHooks } from "../src/capture/engine";
import type { ChannelRef } from "../src/capture/types";
import { openRetracedDb } from "../src/db/schema";
import { DEFAULT_SETTINGS, type RetracedSettings } from "../src/settings";
import { dateKey } from "../src/util/time";

const ME = "100";
const PEER = "200";
const T0 = Date.parse("2026-07-16T12:00:00.000Z");
const D0 = dateKey(T0);

interface FakeDiscord {
  hooks: CaptureHooks;
  dispatch(type: string, action: any): void;
  handlerCount(): number;
  typingStart(channelId: string): void;
  typingStop(channelId: string): void;
  typingPatched(): boolean;
  ownUserId: string | null;
}

function fakeDiscord(): FakeDiscord {
  const subs = new Map<string, Set<(a: any) => void>>();
  let onTypingStart: ((c: string) => void) | null = null;
  let onTypingStop: ((c: string) => void) | null = null;

  const resolveChannel = (id: string): ChannelRef =>
    id.startsWith("dm")
      ? { channelId: id, guildId: null, kind: "dm" }
      : { channelId: id, guildId: "g1", kind: "guild" };

  const self: FakeDiscord = {
    ownUserId: ME,
    hooks: {
      subscribeDispatch: (type, handler) => {
        let set = subs.get(type);
        if (!set) subs.set(type, (set = new Set()));
        set.add(handler);
        return () => set!.delete(handler);
      },
      patchTyping: (start, stop) => {
        onTypingStart = start;
        onTypingStop = stop;
        return () => {
          onTypingStart = null;
          onTypingStop = null;
        };
      },
      getOwnUserId: () => self.ownUserId,
      resolveChannel,
      resolveDmRecipients: (id) => (id === "dm1" ? [PEER] : null),
      resolveUser: (id) => ({ label: `user-${id}`, avatarHash: null }),
      getVoiceChannelMembers: () => [],
    },
    dispatch: (type, action) => {
      for (const handler of subs.get(type) ?? []) handler(action);
    },
    handlerCount: () => [...subs.values()].reduce((n, s) => n + s.size, 0),
    typingStart: (c) => onTypingStart?.(c),
    typingStop: (c) => onTypingStop?.(c),
    typingPatched: () => onTypingStart !== null,
  };
  return self;
}

function makeEngine(discord: FakeDiscord, settings: Partial<RetracedSettings> = {}) {
  return new CaptureEngine({
    hooks: discord.hooks,
    settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
  });
}

const message = (over: Record<string, unknown> = {}, actionOver: Record<string, unknown> = {}) => ({
  type: "MESSAGE_CREATE",
  channelId: (over.channel_id as string) ?? "dm1",
  message: {
    id: `m-${Math.random().toString(36).slice(2)}`,
    channel_id: "dm1",
    author: { id: ME },
    content: "hello world",
    timestamp: new Date(T0).toISOString(),
    attachments: [],
    embeds: [],
    ...over,
  },
  ...actionOver,
});

let discord: FakeDiscord;
let engine: CaptureEngine;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  // fake-indexeddb runs its transaction lifecycle on setImmediate — keep that real
  vi.useFakeTimers({ now: T0, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  discord = fakeDiscord();
  engine = makeEngine(discord);
});

afterEach(async () => {
  await engine.stop();
  vi.useRealTimers();
});

describe("CaptureEngine", () => {
  test("captures a message and flushes it after the debounce", async () => {
    await engine.start();
    expect(engine.getSnapshot().status).toBe("running");
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    expect(engine.getSnapshot().session.byKind["message-created"]).toBe(1);

    await vi.advanceTimersByTimeAsync(5_100);
    const db = await openRetracedDb();
    expect((await db.get("messages", "m1"))!.content).toBe("hello world");
    expect((await db.get("daily", [D0, "dm1"]))!.sent).toBe(1);
    db.close();
  });

  test("multiple events inside one debounce window flush once", async () => {
    await engine.start();
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await vi.advanceTimersByTimeAsync(1_000);
    discord.dispatch("MESSAGE_CREATE", message({ id: "m2" }));
    await vi.advanceTimersByTimeAsync(4_200);
    await engine.flushNow(); // synchronize with the timer-triggered flush
    expect(engine.getSnapshot().session.flushes).toBe(1);
    expect(engine.getSnapshot().session.flushedEvents).toBe(2);
  });

  test("duplicate MESSAGE_UPDATE actions (same edited_timestamp) count once", async () => {
    await engine.start();
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    const edit = {
      type: "MESSAGE_UPDATE",
      message: {
        id: "m1",
        channel_id: "dm1",
        author: { id: ME },
        content: "v2",
        timestamp: new Date(T0).toISOString(),
        edited_timestamp: new Date(T0 + 10_000).toISOString(),
      },
    };
    discord.dispatch("MESSAGE_UPDATE", edit);
    discord.dispatch("MESSAGE_UPDATE", edit);
    await vi.advanceTimersByTimeAsync(5_100);

    const db = await openRetracedDb();
    expect((await db.get("messages", "m1"))!.editCount).toBe(1);
    expect((await db.get("daily", [D0, "dm1"]))!.edited).toBe(1);
    db.close();
  });

  test("typing pings resolve committed through a real message", async () => {
    await engine.start();
    discord.typingStart("dm1");
    await vi.advanceTimersByTimeAsync(3_000);
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1", timestamp: new Date(T0 + 3_000).toISOString() }));
    await vi.advanceTimersByTimeAsync(5_100);

    const db = await openRetracedDb();
    const daily = (await db.get("daily", [D0, "dm1"]))!;
    expect(daily.typingCommitted).toBe(1);
    expect(daily.typingMs).toBe(3_000);
    db.close();
  });

  test("abandoned typing resolves aborted via the sweep", async () => {
    await engine.start();
    discord.typingStart("dm1");
    await vi.advanceTimersByTimeAsync(20_000); // sweeps run every 3s; lapse is 12s
    await vi.advanceTimersByTimeAsync(5_100);

    const db = await openRetracedDb();
    const daily = (await db.get("daily", [D0, "dm1"]))!;
    expect(daily.typingAborted).toBe(1);
    const peer = (await db.get("peers", PEER))!;
    expect(peer.typingAbortedAtThem).toBe(1);
    db.close();
  });

  test("stop() flushes pending data and removes every subscription", async () => {
    await engine.start();
    const active = discord.handlerCount();
    expect(active).toBeGreaterThan(0);
    expect(discord.typingPatched()).toBe(true);

    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await engine.stop(); // no debounce wait — stop must flush

    expect(discord.handlerCount()).toBe(0);
    expect(discord.typingPatched()).toBe(false);
    const db = await openRetracedDb();
    expect(await db.get("messages", "m1")).toBeDefined();
    db.close();

    discord.dispatch("MESSAGE_CREATE", message({ id: "m2" }));
    expect(engine.getSnapshot().session.byKind["message-created"] ?? 0).toBe(0);
  });

  test("start → stop → start yields exactly one set of subscriptions, no double counting", async () => {
    await engine.start();
    const firstCount = discord.handlerCount();
    await engine.stop();
    engine = makeEngine(discord);
    await engine.start();
    expect(discord.handlerCount()).toBe(firstCount);

    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await vi.advanceTimersByTimeAsync(5_100);
    const db = await openRetracedDb();
    expect((await db.get("daily", [D0, "dm1"]))!.sent).toBe(1);
    db.close();
  });

  test("channel heads survive engine restarts — no phantom initiations", async () => {
    await engine.start();
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await engine.stop();

    engine = makeEngine(discord);
    await engine.start();
    discord.dispatch(
      "MESSAGE_CREATE",
      message({ id: "m2", author: { id: PEER }, timestamp: new Date(T0 + 5 * 60_000).toISOString() })
    );
    await engine.stop();

    const db = await openRetracedDb();
    const daily = (await db.get("daily", [D0, "dm1"]))!;
    expect(daily.initiatedByMe).toBe(1); // only the very first message
    expect(daily.initiatedByThem).toBe(0); // 5min gap — not an initiation
    db.close();
  });

  test("an open usage session survives engine restarts — no split at the boundary", async () => {
    await engine.start();
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await engine.stop();

    engine = makeEngine(discord);
    await engine.start();
    // still inside the 30min session gap — must EXTEND the hydrated session, not open a new one
    discord.dispatch("MESSAGE_CREATE", message({ id: "m2", timestamp: new Date(T0 + 10 * 60_000).toISOString() }));
    // far beyond the gap — resolves the 10-minute session
    discord.dispatch("MESSAGE_CREATE", message({ id: "m3", timestamp: new Date(T0 + 50 * 60_000).toISOString() }));
    await engine.stop();

    const db = await openRetracedDb();
    const row = (await db.get("sessions", D0))!;
    expect(row.totalMs).toBe(10 * 60_000);
    expect(row.buckets.reduce((a, b) => a + b, 0)).toBe(1);
    db.close();
  });

  test("the kill switch stops text at capture even for own DM messages", async () => {
    await engine.stop();
    engine = makeEngine(discord, { contentStorageEnabled: false });
    await engine.start();
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await vi.advanceTimersByTimeAsync(5_100);

    const db = await openRetracedDb();
    const row = (await db.get("messages", "m1"))!;
    expect(row.content).toBeNull();
    expect(row.chars).toBe(11);
    expect((await db.get("daily", [D0, "dm1"]))!.sent).toBe(1);
    db.close();
  });

  test("purgeContent drops stored text but keeps rollups (the kill-switch contract)", async () => {
    await engine.start();
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await engine.flushNow();

    await engine.purgeContent();

    const db = await openRetracedDb();
    expect(await db.count("messages")).toBe(0);
    expect(await db.count("searchIndex")).toBe(0);
    expect(await db.count("words")).toBe(0);
    expect((await db.get("daily", [D0, "dm1"]))!.sent).toBe(1);
    db.close();
  });

  test("dwell flows from CHANNEL_SELECT through to the daily rollup", async () => {
    await engine.start();
    discord.dispatch("CHANNEL_SELECT", { channelId: "g-chan1", guildId: "g1" });
    await vi.advanceTimersByTimeAsync(10_000);
    discord.dispatch("CHANNEL_SELECT", { channelId: "dm1" });
    await vi.advanceTimersByTimeAsync(5_100);

    const db = await openRetracedDb();
    expect((await db.get("daily", [dateKey(T0), "g-chan1"]))!.dwellMs).toBe(10_000);
    db.close();
  });

  test("a missing user id degrades capture without crashing", async () => {
    await engine.stop();
    discord.ownUserId = null;
    engine = makeEngine(discord);
    await engine.start();
    expect(engine.getSnapshot().status).toBe("degraded");
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1" }));
    await vi.advanceTimersByTimeAsync(5_100);
    expect(engine.getSnapshot().session.dropped).toBe(1);

    const db = await openRetracedDb();
    expect(await db.get("messages", "m1")).toBeUndefined();
    db.close();
  });

  test("events ring buffer receives everything and prune-on-start trims it", async () => {
    await engine.start();
    discord.dispatch("MESSAGE_CREATE", message({ id: "m1", timestamp: new Date(T0 - 40 * 86_400_000).toISOString() }));
    discord.dispatch("MESSAGE_CREATE", message({ id: "m2" }));
    await engine.stop();

    // a fresh engine prunes events older than eventRetentionDays (30) on start
    engine = makeEngine(discord);
    await engine.start();
    await vi.advanceTimersByTimeAsync(100);
    const db = await openRetracedDb();
    expect(await db.count("events")).toBe(1);
    db.close();
  });
});
