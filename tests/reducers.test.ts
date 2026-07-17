import { beforeEach, describe, expect, test } from "vitest";
import { PendingBuffer } from "../src/aggregate/pending";
import { createReducerContext, reduceEvent, type ReducerContext } from "../src/aggregate/reducers";
import type { ChannelRef, MessageCreatedEvent, ReactionEvent, TypingResolvedEvent } from "../src/capture/types";
import { dateKey, hourOf } from "../src/util/time";

const ME = "100";
const PEER = "200";
const PEER2 = "300";

const dm: ChannelRef = { channelId: "dm1", guildId: null, kind: "dm" };
const group: ChannelRef = { channelId: "group1", guildId: null, kind: "group-dm" };
const guild: ChannelRef = { channelId: "chan1", guildId: "g1", kind: "guild" };

const T0 = Date.parse("2026-07-16T12:00:00.000Z");
const D0 = dateKey(T0);
const H0 = hourOf(T0);

let pending: PendingBuffer;
let ctx: ReducerContext;

beforeEach(() => {
  pending = new PendingBuffer();
  ctx = createReducerContext({
    ownUserId: ME,
    settings: () => ({ conversationGapMinutes: 30 }),
    resolvePeerLabel: (id) => ({ label: `user-${id}`, avatarHash: null }),
    dmRecipients: (channelId) => (channelId === "dm1" ? [PEER] : channelId === "group1" ? [PEER, PEER2] : null),
  });
});

function msg(over: Partial<MessageCreatedEvent> = {}): MessageCreatedEvent {
  return {
    kind: "message-created",
    ts: T0,
    channel: dm,
    messageId: `m${Math.abs(over.ts ?? T0)}-${over.authorId ?? ME}`,
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

const daily = (channelId: string, date = D0) => pending.daily.get(`${date} ${channelId}`);
const peer = (id: string) => pending.peers.get(id);

describe("daily and hourly rollups are OWN-activity scoped", () => {
  test("own message bumps sent/chars/words/hourly/contentTypes", () => {
    reduceEvent(msg({ channel: guild }), pending, ctx);
    const d = daily("chan1")!;
    expect(d).toMatchObject({ guildId: "g1", sent: 1, chars: 11, words: 2 });
    expect(d.contentTypes.text).toBe(1);
    expect(pending.hourly.get(`${D0} ${H0}`)).toBe(1);
  });

  test("someone else's message does NOT bump own-activity counts or hourly", () => {
    reduceEvent(msg({ authorId: PEER, isOwn: false, channel: guild, content: null }), pending, ctx);
    const d = daily("chan1")!;
    expect(d).toMatchObject({ sent: 0, chars: 0, words: 0, uniqueWords: 0 });
    expect(d.contentTypes.text).toBe(0);
    // …but two-sided fields still apply: their first message initiates the conversation
    expect(d.initiatedByThem).toBe(1);
    expect(pending.hourly.size).toBe(0);
  });

  test("uniqueWords counts new words per day+channel only once", () => {
    reduceEvent(msg({ content: "alpha beta", words: 2 }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1000, content: "beta gamma!", words: 2 }), pending, ctx);
    expect(daily("dm1")!.uniqueWords).toBe(3); // alpha, beta, gamma
  });

  test("every event lands in the ring-buffer list", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1, authorId: PEER, isOwn: false }), pending, ctx);
    expect(pending.events).toHaveLength(2);
  });
});

describe("message rows", () => {
  test("own message creates a full row; other's guild message a null-content row", () => {
    reduceEvent(msg({ channel: guild, messageId: "own1" }), pending, ctx);
    reduceEvent(msg({ channel: guild, messageId: "their1", authorId: PEER, isOwn: false, content: null }), pending, ctx);
    expect(pending.messageCreates.get("own1")!.content).toBe("hello world");
    const theirs = pending.messageCreates.get("their1")!;
    expect(theirs.content).toBeNull();
    expect(theirs.isOwn).toBe(false);
    expect(theirs.chars).toBe(11);
  });
});

describe("peer counters (1:1 DM scoped for message counts)", () => {
  test("own DM message counts msgToThem; theirs counts msgFromThem", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1000, authorId: PEER, isOwn: false }), pending, ctx);
    expect(peer(PEER)).toMatchObject({ msgToThem: 1, msgFromThem: 1, label: `user-${PEER}` });
  });

  test("group DM messages count msgFromThem per author but not msgToThem", () => {
    reduceEvent(msg({ channel: group }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1000, channel: group, authorId: PEER2, isOwn: false }), pending, ctx);
    expect(peer(PEER)?.msgToThem ?? 0).toBe(0);
    expect(peer(PEER2)).toMatchObject({ msgFromThem: 1 });
  });

  test("guild messages never touch peer message counts", () => {
    reduceEvent(msg({ channel: guild }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1000, channel: guild, authorId: PEER, isOwn: false }), pending, ctx);
    expect(peer(PEER)).toBeUndefined();
  });
});

describe("conversation bursts", () => {
  test("burst length grows within a conversation and is rolled up as a daily max", () => {
    reduceEvent(msg({ messageId: "b1" }), pending, ctx);
    reduceEvent(msg({ messageId: "b2", ts: T0 + 10_000, authorId: PEER, isOwn: false }), pending, ctx);
    reduceEvent(msg({ messageId: "b3", ts: T0 + 20_000 }), pending, ctx);
    expect(daily("dm1")!.longestBurst).toBe(3);
  });

  test("an initiation resets the burst (observed across a day boundary)", () => {
    reduceEvent(msg({ messageId: "b1" }), pending, ctx);
    reduceEvent(msg({ messageId: "b2", ts: T0 + 10_000, authorId: PEER, isOwn: false }), pending, ctx);
    // next local day, long silence — new conversation restarts the burst at 1
    const nextDay = T0 + 20 * 3_600_000;
    reduceEvent(msg({ messageId: "b3", ts: nextDay }), pending, ctx);
    expect(dateKey(nextDay)).not.toBe(D0);
    expect(daily("dm1", dateKey(nextDay))!.longestBurst).toBe(1);
    expect(daily("dm1")!.longestBurst).toBe(2); // the first day's max is untouched
  });

  test("bursts are tracked per channel", () => {
    reduceEvent(msg({ messageId: "b1" }), pending, ctx);
    reduceEvent(msg({ messageId: "b2", ts: T0 + 5_000, channel: guild }), pending, ctx);
    reduceEvent(msg({ messageId: "b3", ts: T0 + 10_000 }), pending, ctx);
    expect(daily("dm1")!.longestBurst).toBe(2);
    expect(daily("chan1")!.longestBurst).toBe(1);
  });
});

describe("conversation initiation", () => {
  test("first-ever message in a channel is an initiation", () => {
    reduceEvent(msg(), pending, ctx);
    expect(daily("dm1")!.initiatedByMe).toBe(1);
    expect(peer(PEER)!.initiatedByMe).toBe(1);
  });

  test("a message within the gap is not an initiation", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 10 * 60_000, authorId: PEER, isOwn: false }), pending, ctx);
    expect(daily("dm1")!.initiatedByThem).toBe(0);
    expect(peer(PEER)!.initiatedByThem).toBe(0);
  });

  test("a message after the gap attributes the initiation to its author", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 31 * 60_000, authorId: PEER, isOwn: false }), pending, ctx);
    expect(daily("dm1", dateKey(T0 + 31 * 60_000))!.initiatedByThem).toBe(1);
    expect(peer(PEER)!.initiatedByThem).toBe(1);
  });

  test("the gap setting is honoured", () => {
    ctx = createReducerContext({
      ownUserId: ME,
      settings: () => ({ conversationGapMinutes: 5 }),
      resolvePeerLabel: () => null,
      dmRecipients: () => [PEER],
    });
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 6 * 60_000 }), pending, ctx);
    expect(daily("dm1", dateKey(T0 + 6 * 60_000))!.initiatedByMe).toBe(2);
  });
});

describe("reply latency histograms", () => {
  test("my DM reply 20s after theirs lands in the 10–30s bucket of latencyMine", () => {
    reduceEvent(msg({ authorId: PEER, isOwn: false }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 20_000 }), pending, ctx);
    expect(peer(PEER)!.latencyMine).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });

  test("their reply 5s after mine lands in latencyTheirs bucket 0", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 5_000, authorId: PEER, isOwn: false }), pending, ctx);
    expect(peer(PEER)!.latencyTheirs).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  test("consecutive messages from the same side record no latency", () => {
    reduceEvent(msg(), pending, ctx);
    reduceEvent(msg({ ts: T0 + 5_000 }), pending, ctx);
    expect(peer(PEER)!.latencyMine).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test("flow gaps beyond 6h are dropped (overnight gaps are not replies)", () => {
    reduceEvent(msg({ authorId: PEER, isOwn: false }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 7 * 3_600_000 }), pending, ctx);
    expect(peer(PEER)!.latencyMine).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test("explicit guild replies record latency against the replied-to author", () => {
    reduceEvent(
      msg({ channel: guild, replyToId: "orig", replyToAuthorId: PEER, replyToTs: T0 - 90_000 }),
      pending,
      ctx
    );
    expect(peer(PEER)!.latencyMine).toEqual([0, 0, 1, 0, 0, 0, 0]); // 90s → 30s–2m
  });

  test("explicit reply older than 6h lands in the 6h+ bucket", () => {
    reduceEvent(
      msg({ channel: guild, replyToId: "orig", replyToAuthorId: PEER, replyToTs: T0 - 10 * 3_600_000 }),
      pending,
      ctx
    );
    expect(peer(PEER)!.latencyMine).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  test("their explicit reply to me records latencyTheirs", () => {
    reduceEvent(
      msg({ channel: guild, authorId: PEER, isOwn: false, content: null, replyToId: "orig", replyToAuthorId: ME, replyToTs: T0 - 40_000 }),
      pending,
      ctx
    );
    expect(peer(PEER)!.latencyTheirs).toEqual([0, 0, 1, 0, 0, 0, 0]);
  });
});

describe("typing resolutions", () => {
  const typing = (over: Partial<TypingResolvedEvent> = {}): TypingResolvedEvent => ({
    kind: "typing-resolved",
    ts: T0,
    channel: dm,
    startedAt: T0 - 8000,
    durationMs: 8000,
    committed: true,
    peerId: PEER,
    ...over,
  });

  test("committed sessions bump typingCommitted and typingMs", () => {
    reduceEvent(typing(), pending, ctx);
    expect(daily("dm1")).toMatchObject({ typingCommitted: 1, typingAborted: 0, typingMs: 8000 });
  });

  test("aborted DM sessions also count against the peer", () => {
    reduceEvent(typing({ committed: false }), pending, ctx);
    expect(daily("dm1")).toMatchObject({ typingAborted: 1 });
    expect(peer(PEER)!.typingAbortedAtThem).toBe(1);
  });
});

describe("reactions", () => {
  const reaction = (over: Partial<ReactionEvent> = {}): ReactionEvent => ({
    kind: "reaction",
    ts: T0,
    channel: guild,
    direction: 1,
    actorId: ME,
    actorIsOwn: true,
    messageId: "m1",
    messageAuthorId: PEER,
    messageAuthorIsOwn: false,
    emoji: { id: null, name: "👍" },
    ...over,
  } as ReactionEvent);

  test("my reaction counts as given, theirs to me as received", () => {
    reduceEvent(reaction(), pending, ctx);
    reduceEvent(reaction({ actorId: PEER, actorIsOwn: false, messageAuthorId: ME, messageAuthorIsOwn: true }), pending, ctx);
    const d = daily("chan1")!;
    expect(d.reactionsGiven).toBe(1);
    expect(d.reactionsReceived).toBe(1);
    expect(peer(PEER)).toMatchObject({ reactionsToThem: 1, reactionsFromThem: 1 });
  });

  test("removals are negative deltas", () => {
    reduceEvent(reaction({ direction: -1 }), pending, ctx);
    expect(daily("chan1")!.reactionsGiven).toBe(-1);
  });

  test("my custom-emoji reaction counts emoji usage in the guild scope", () => {
    reduceEvent(reaction({ emoji: { id: "e1", name: "pog" } }), pending, ctx);
    expect(pending.emoji.get(`g1 e1`)).toEqual({ name: "pog", count: 1 });
  });
});

describe("emoji and domains from messages", () => {
  test("own custom emoji counted under the channel's guild scope; DMs under 'dm'", () => {
    reduceEvent(msg({ channel: guild, customEmoji: [{ id: "e1", name: "pog" }] }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1, customEmoji: [{ id: "e1", name: "pog" }] }), pending, ctx);
    expect(pending.emoji.get(`g1 e1`)!.count).toBe(1);
    expect(pending.emoji.get(`dm e1`)!.count).toBe(1);
  });

  test("other people's emoji are not counted", () => {
    reduceEvent(msg({ authorId: PEER, isOwn: false, customEmoji: [{ id: "e1", name: "pog" }] }), pending, ctx);
    expect(pending.emoji.size).toBe(0);
  });

  test("domains accumulate from all messages", () => {
    reduceEvent(msg({ domains: ["example.com"] }), pending, ctx);
    reduceEvent(msg({ ts: T0 + 1000, authorId: PEER, isOwn: false, domains: ["example.com", "foo.bar"] }), pending, ctx);
    expect(pending.domains.get("example.com")).toMatchObject({ count: 2 });
    expect(pending.domains.get("foo.bar")).toMatchObject({ count: 1 });
  });
});

describe("dwell and voice", () => {
  test("dwell accumulates into daily.dwellMs", () => {
    reduceEvent({ kind: "dwell", ts: T0, channel: guild, durationMs: 30_000 }, pending, ctx);
    reduceEvent({ kind: "dwell", ts: T0 + 60_000, channel: guild, durationMs: 15_000 }, pending, ctx);
    expect(daily("chan1")!.dwellMs).toBe(45_000);
  });

  test("voice segments accumulate seconds and co-presence", () => {
    reduceEvent({ kind: "voice-segment", ts: T0, channel: guild, seconds: 600, coPresent: { [PEER]: 600 } }, pending, ctx);
    reduceEvent({ kind: "voice-segment", ts: T0 + 10, channel: guild, seconds: 300, coPresent: { [PEER]: 100, [PEER2]: 300 } }, pending, ctx);
    expect(pending.voice.get(`${D0} chan1`)).toEqual({
      guildId: "g1",
      seconds: 900,
      coPresent: { [PEER]: 700, [PEER2]: 300 },
    });
  });
});

describe("edits and deletes queue for flush-time resolution", () => {
  test("own edit bumps daily.edited and queues the revision merge", () => {
    reduceEvent(
      { kind: "message-edited", ts: T0, channel: dm, messageId: "m1", authorId: ME, isOwn: true, content: "new", editLatencyMs: 5000 },
      pending,
      ctx
    );
    expect(daily("dm1")!.edited).toBe(1);
    expect(pending.messageEdits).toHaveLength(1);
  });

  test("someone else's edit queues but does not touch daily", () => {
    reduceEvent(
      { kind: "message-edited", ts: T0, channel: dm, messageId: "m1", authorId: PEER, isOwn: false, content: "new", editLatencyMs: null },
      pending,
      ctx
    );
    expect(daily("dm1")).toBeUndefined();
    expect(pending.messageEdits).toHaveLength(1);
  });

  test("deletes queue for flush-time attribution", () => {
    reduceEvent({ kind: "message-deleted", ts: T0, channelId: "dm1", guildId: null, messageId: "m1" }, pending, ctx);
    expect(pending.messageDeletes).toHaveLength(1);
    expect(daily("dm1")).toBeUndefined(); // attribution needs the stored row — flush's job
  });
});
