import { beforeEach, describe, expect, test, vi } from "vitest";
import { TypingTracker, type TypingResolution } from "../src/capture/hesitation";
import type { ChannelRef } from "../src/capture/types";

const dm: ChannelRef = { channelId: "dm1", guildId: null, kind: "dm" };
const guild: ChannelRef = { channelId: "chan1", guildId: "g1", kind: "guild" };

let now = 1_000_000;
let resolutions: TypingResolution[];
let tracker: TypingTracker;

beforeEach(() => {
  now = 1_000_000;
  resolutions = [];
  tracker = new TypingTracker({
    now: () => now,
    resolve: (r) => resolutions.push(r),
    resolveChannel: (id) => (id === "dm1" ? dm : guild),
    resolveDmPeer: (id) => (id === "dm1" ? "peer1" : null),
  });
});

const advance = (ms: number) => {
  now += ms;
};

describe("TypingTracker — commit path", () => {
  test("ping then own message resolves committed with duration", () => {
    tracker.ping("dm1");
    advance(4_000);
    tracker.messageSent("dm1");
    expect(resolutions).toEqual([
      { channel: dm, startedAt: 1_000_000, durationMs: 4_000, committed: true, peerId: "peer1", resolvedAt: 1_004_000 },
    ]);
  });

  test("message without a typing session resolves nothing", () => {
    tracker.messageSent("dm1");
    expect(resolutions).toHaveLength(0);
  });

  test("repeated pings extend the session; commit measures from first ping", () => {
    tracker.ping("chan1");
    advance(8_000);
    tracker.ping("chan1");
    advance(8_000);
    tracker.sweep(); // lastSeen is 8s ago — under the 12s lapse, stays alive
    expect(resolutions).toHaveLength(0);
    advance(2_000);
    tracker.messageSent("chan1");
    expect(resolutions[0]).toMatchObject({ committed: true, durationMs: 18_000, peerId: null });
  });
});

describe("TypingTracker — abort paths", () => {
  test("no refresh for over 12s resolves aborted with the observed typing span", () => {
    tracker.ping("dm1");
    advance(9_000);
    tracker.ping("dm1");
    advance(12_500);
    tracker.sweep();
    expect(resolutions).toEqual([
      { channel: dm, startedAt: 1_000_000, durationMs: 9_000, committed: false, peerId: "peer1", resolvedAt: 1_021_500 },
    ]);
  });

  test("sweep before the lapse does not resolve", () => {
    tracker.ping("dm1");
    advance(11_000);
    tracker.sweep();
    expect(resolutions).toHaveLength(0);
  });

  test("explicit stop resolves aborted after the grace period", () => {
    tracker.ping("dm1");
    advance(6_000);
    tracker.stopped("dm1");
    advance(4_000);
    tracker.sweep(); // grace not yet expired (5s default)
    expect(resolutions).toHaveLength(0);
    advance(1_500);
    tracker.sweep();
    expect(resolutions).toEqual([
      { channel: dm, startedAt: 1_000_000, durationMs: 6_000, committed: false, peerId: "peer1", resolvedAt: 1_011_500 },
    ]);
  });

  test("own message within the stop grace still commits (send flow: stopTyping then echo)", () => {
    tracker.ping("dm1");
    advance(6_000);
    tracker.stopped("dm1");
    advance(300);
    tracker.messageSent("dm1");
    expect(resolutions[0]).toMatchObject({ committed: true, durationMs: 6_300 });
  });

  test("typing again after a stop cancels the pending abort", () => {
    tracker.ping("dm1");
    advance(3_000);
    tracker.stopped("dm1");
    advance(2_000);
    tracker.ping("dm1"); // resumed typing
    advance(6_000);
    tracker.sweep(); // grace would have expired, but the session resumed
    expect(resolutions).toHaveLength(0);
  });
});

describe("TypingTracker — isolation and lifecycle", () => {
  test("channels are tracked independently", () => {
    tracker.ping("dm1");
    advance(1_000);
    tracker.ping("chan1");
    advance(2_000);
    tracker.messageSent("dm1");
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]!.channel).toBe(dm);
    advance(13_000);
    tracker.sweep(); // chan1 lapses (switched channels mid-type)
    expect(resolutions).toHaveLength(2);
    expect(resolutions[1]).toMatchObject({ channel: guild, committed: false });
  });

  test("dispose discards open sessions without resolving them", () => {
    tracker.ping("dm1");
    tracker.ping("chan1");
    tracker.dispose();
    advance(60_000);
    tracker.sweep();
    tracker.messageSent("dm1");
    expect(resolutions).toHaveLength(0);
  });

  test("a resolved session leaves no residue — the next ping starts fresh", () => {
    tracker.ping("dm1");
    advance(2_000);
    tracker.messageSent("dm1");
    advance(30_000);
    tracker.ping("dm1");
    advance(1_000);
    tracker.messageSent("dm1");
    expect(resolutions).toHaveLength(2);
    expect(resolutions[1]).toMatchObject({ startedAt: 1_032_000, durationMs: 1_000, committed: true });
  });

  test("custom lapse and grace are honoured", () => {
    const local: TypingResolution[] = [];
    const t = new TypingTracker({
      now: () => now,
      resolve: (r) => local.push(r),
      resolveChannel: () => guild,
      resolveDmPeer: () => null,
      lapseMs: 5_000,
      stopGraceMs: 1_000,
    });
    t.ping("chan1");
    advance(5_500);
    t.sweep();
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ committed: false });
  });
});

describe("TypingTracker — session counters", () => {
  test("exposes live counts for the readout", () => {
    tracker.ping("dm1");
    tracker.ping("chan1");
    expect(tracker.openSessionCount).toBe(2);
    tracker.messageSent("dm1");
    expect(tracker.openSessionCount).toBe(1);
  });
});
