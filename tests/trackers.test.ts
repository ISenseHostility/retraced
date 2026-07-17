import { beforeEach, describe, expect, test } from "vitest";
import { DwellTracker } from "../src/capture/dwell";
import type { ChannelRef, DwellEvent, VoiceSegmentEvent } from "../src/capture/types";
import { VoiceTracker } from "../src/capture/voice";

const chanA: ChannelRef = { channelId: "a", guildId: "g1", kind: "guild" };
const chanB: ChannelRef = { channelId: "b", guildId: "g1", kind: "guild" };
const vc: ChannelRef = { channelId: "vc1", guildId: "g1", kind: "guild" };

const resolveChannel = (id: string): ChannelRef => (id === "a" ? chanA : id === "b" ? chanB : vc);

let now: number;
const advance = (ms: number) => {
  now += ms;
};

describe("DwellTracker", () => {
  let events: DwellEvent[];
  let focused: boolean;
  let tracker: DwellTracker;

  beforeEach(() => {
    now = 1_000_000;
    events = [];
    focused = true;
    tracker = new DwellTracker({
      now: () => now,
      emit: (e) => events.push(e),
      resolveChannel,
      isFocused: () => focused,
    });
  });

  test("switching channels emits the dwell for the previous one", () => {
    tracker.channelSelected("a");
    advance(10_000);
    tracker.channelSelected("b");
    expect(events).toEqual([{ kind: "dwell", ts: 1_000_000, channel: chanA, durationMs: 10_000 }]);
  });

  test("blurred time does not count as dwell", () => {
    tracker.channelSelected("a");
    advance(5_000);
    tracker.focusChanged(false);
    advance(60_000); // afk with the window in the background
    tracker.focusChanged(true);
    advance(3_000);
    tracker.channelSelected(null);
    expect(events[0]).toMatchObject({ durationMs: 8_000 });
  });

  test("a channel opened while unfocused starts counting on focus", () => {
    focused = false;
    tracker.channelSelected("a");
    advance(30_000);
    focused = true;
    tracker.focusChanged(true);
    advance(4_000);
    tracker.closeAll();
    expect(events[0]).toMatchObject({ durationMs: 4_000 });
  });

  test("sub-second dwells are dropped as navigation noise", () => {
    tracker.channelSelected("a");
    advance(300);
    tracker.channelSelected("b");
    expect(events).toHaveLength(0);
  });

  test("closeAll flushes the open segment exactly once", () => {
    tracker.channelSelected("a");
    advance(7_000);
    tracker.closeAll();
    tracker.closeAll();
    expect(events).toHaveLength(1);
  });
});

describe("VoiceTracker", () => {
  let events: VoiceSegmentEvent[];
  let tracker: VoiceTracker;

  beforeEach(() => {
    now = 1_000_000;
    events = [];
    tracker = new VoiceTracker({
      now: () => now,
      emit: (e) => events.push(e),
      resolveChannel,
      ownUserId: "100",
      getChannelMembers: (id) => (id === "vc1" ? ["100", "200"] : []),
    });
  });

  test("own join then leave emits one segment with seeded co-presence", () => {
    tracker.handleVoiceStates([{ userId: "100", channelId: "vc1" }]);
    advance(60_000);
    tracker.handleVoiceStates([{ userId: "100", channelId: null }]);
    expect(events).toEqual([
      { kind: "voice-segment", ts: 1_000_000, channel: vc, seconds: 60, coPresent: { "200": 60 } },
    ]);
  });

  test("co-presence is partial when someone joins or leaves mid-session", () => {
    tracker.handleVoiceStates([{ userId: "100", channelId: "vc1" }]);
    advance(30_000);
    tracker.handleVoiceStates([{ userId: "300", channelId: "vc1" }]); // 300 joins at 30s
    advance(30_000);
    tracker.handleVoiceStates([{ userId: "200", channelId: null }]); // 200 leaves at 60s
    advance(30_000);
    tracker.handleVoiceStates([{ userId: "100", channelId: null }]); // I leave at 90s
    expect(events[0]).toEqual({
      kind: "voice-segment",
      ts: 1_000_000,
      channel: vc,
      seconds: 90,
      coPresent: { "200": 60, "300": 60 },
    });
  });

  test("moving between voice channels closes one segment and opens another", () => {
    tracker.handleVoiceStates([{ userId: "100", channelId: "vc1" }]);
    advance(45_000);
    tracker.handleVoiceStates([{ userId: "100", channelId: "vc2" }]);
    advance(15_000);
    tracker.handleVoiceStates([{ userId: "100", channelId: null }]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ seconds: 45 });
    expect(events[1]).toMatchObject({ seconds: 15, ts: 1_045_000 });
  });

  test("other people's updates while I am not in voice are ignored", () => {
    tracker.handleVoiceStates([{ userId: "200", channelId: "vc1" }]);
    advance(10_000);
    tracker.handleVoiceStates([{ userId: "200", channelId: null }]);
    expect(events).toHaveLength(0);
  });

  test("closeAll emits the open segment (plugin stop mid-call)", () => {
    tracker.handleVoiceStates([{ userId: "100", channelId: "vc1" }]);
    advance(20_000);
    tracker.closeAll();
    expect(events[0]).toMatchObject({ seconds: 20 });
    tracker.closeAll();
    expect(events).toHaveLength(1);
  });

  test("very short segments are dropped", () => {
    tracker.handleVoiceStates([{ userId: "100", channelId: "vc1" }]);
    advance(500);
    tracker.handleVoiceStates([{ userId: "100", channelId: null }]);
    expect(events).toHaveLength(0);
  });
});
