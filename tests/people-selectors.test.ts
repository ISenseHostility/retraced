import { describe, expect, test } from "vitest";
import { REPLY_BUCKET_COUNT } from "../src/aggregate/buckets";
import type { PeerRow, VoiceRow } from "../src/db/schema";
import {
  REPLY_BUCKET_LABELS,
  initiatorRatio,
  latencyDistribution,
  reactionBalance,
  replyMedians,
  socialGraph,
} from "../src/ui/data/people";

function peer(over: Partial<PeerRow>): PeerRow {
  return {
    userId: "200",
    label: null,
    avatarHash: null,
    msgToThem: 0,
    msgFromThem: 0,
    initiatedByMe: 0,
    initiatedByThem: 0,
    latencyBucketsMine: new Array(REPLY_BUCKET_COUNT).fill(0),
    latencyBucketsTheirs: new Array(REPLY_BUCKET_COUNT).fill(0),
    typingAbortedAtThem: 0,
    reactionsToThem: 0,
    reactionsFromThem: 0,
    firstSeenTs: 0,
    lastSeenTs: 0,
    ...over,
  };
}

const voiceRow = (coPresent: Record<string, number>, date = "2026-07-01"): VoiceRow => ({
  date,
  channelId: "vc1",
  guildId: "g1",
  seconds: 600,
  coPresent,
});

describe("initiatorRatio", () => {
  const peers = [
    peer({ userId: "1", label: "ana", initiatedByMe: 8, initiatedByThem: 2 }),
    peer({ userId: "2", label: "bo", initiatedByMe: 1, initiatedByThem: 5 }),
    peer({ userId: "3", label: "cy", initiatedByMe: 1, initiatedByThem: 1 }), // under the floor — dropped
  ];

  test("keeps peers with enough conversations and computes their share", () => {
    const out = initiatorRatio(peers, { sortBy: "total" });
    expect(out.map((r) => r.userId)).toEqual(["1", "2"]);
    expect(out[0]).toMatchObject({ label: "ana", mine: 8, theirs: 2, theirSharePct: 20 });
  });

  test('sortBy "them" puts the most them-initiated first', () => {
    const out = initiatorRatio(peers, { sortBy: "them" });
    expect(out[0]!.userId).toBe("2");
  });

  test("caps at max", () => {
    const many = Array.from({ length: 20 }, (_, i) => peer({ userId: String(i), initiatedByMe: 5 + i, initiatedByThem: 5 }));
    expect(initiatorRatio(many, { max: 12 })).toHaveLength(12);
  });
});

describe("replyMedians", () => {
  test("computes the median bucket per direction and drops thin peers", () => {
    const mine = new Array(REPLY_BUCKET_COUNT).fill(0);
    mine[3] = 6; // all my replies in 2–10m
    const theirs = new Array(REPLY_BUCKET_COUNT).fill(0);
    theirs[5] = 4;
    theirs[6] = 3; // their median lands in 1–6h
    const out = replyMedians([
      peer({ userId: "1", label: "ana", latencyBucketsMine: mine, latencyBucketsTheirs: theirs, msgToThem: 10 }),
      peer({ userId: "2", label: "bo", msgToThem: 50 }), // no latency data at all — dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: "1", mineBucket: 3, theirsBucket: 5, mineCount: 6, theirsCount: 7 });
  });

  test("one-sided data still qualifies, the other side is null", () => {
    const mine = new Array(REPLY_BUCKET_COUNT).fill(0);
    mine[1] = 5;
    const out = replyMedians([peer({ userId: "1", latencyBucketsMine: mine })]);
    expect(out[0]!.mineBucket).toBe(1);
    expect(out[0]!.theirsBucket).toBeNull();
  });

  test("caps at max by message volume", () => {
    const mine = new Array(REPLY_BUCKET_COUNT).fill(0);
    mine[0] = 9;
    const many = Array.from({ length: 20 }, (_, i) =>
      peer({ userId: String(i), latencyBucketsMine: [...mine], msgToThem: i })
    );
    const out = replyMedians(many, { max: 15 });
    expect(out).toHaveLength(15);
    expect(out.map((r) => r.userId)).toContain("19"); // highest volume kept
    expect(out.map((r) => r.userId)).not.toContain("0");
  });
});

describe("latencyDistribution", () => {
  test("maps both directions onto labeled buckets", () => {
    const mine = new Array(REPLY_BUCKET_COUNT).fill(0);
    mine[0] = 2;
    const theirs = new Array(REPLY_BUCKET_COUNT).fill(0);
    theirs[6] = 4;
    const rows = latencyDistribution(peer({ latencyBucketsMine: mine, latencyBucketsTheirs: theirs }));
    expect(rows).toHaveLength(REPLY_BUCKET_COUNT);
    expect(rows[0]).toEqual({ label: REPLY_BUCKET_LABELS[0], mine: 2, theirs: 0 });
    expect(rows[6]).toEqual({ label: "6h+", mine: 0, theirs: 4 });
  });
});

describe("socialGraph", () => {
  const peers = [
    peer({ userId: "1", label: "ana", msgToThem: 60, msgFromThem: 40 }),
    peer({ userId: "2", label: "bo", msgToThem: 30, msgFromThem: 10 }),
    peer({ userId: "3", label: "cy", msgToThem: 2, msgFromThem: 2 }), // below threshold
  ];

  test("builds you-centred nodes above the threshold with dm links", () => {
    const graph = socialGraph(peers, [], { threshold: 10 });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["1", "2", "you"]);
    expect(graph.nodes.find((n) => n.id === "you")!.isYou).toBe(true);
    const dmLinks = graph.links.filter((l) => l.kind === "dm");
    expect(dmLinks).toHaveLength(2);
    expect(dmLinks.find((l) => l.target === "1")!.weight).toBe(100);
  });

  test("voice co-presence creates peer-to-peer links weighted by shared seconds", () => {
    const graph = socialGraph(peers, [voiceRow({ "1": 300, "2": 120 }), voiceRow({ "1": 60, "2": 60 }, "2026-07-02")], {
      threshold: 10,
    });
    const voiceLink = graph.links.find((l) => l.kind === "voice")!;
    expect([voiceLink.source, voiceLink.target].sort()).toEqual(["1", "2"]);
    expect(voiceLink.weight).toBe(180); // min(300,120) + min(60,60)
  });

  test("voice partners below the message threshold stay out of the graph", () => {
    const graph = socialGraph(peers, [voiceRow({ "1": 300, "3": 300 })], { threshold: 10 });
    expect(graph.nodes.some((n) => n.id === "3")).toBe(false);
    expect(graph.links.filter((l) => l.kind === "voice")).toHaveLength(0);
  });

  test("caps node count by volume", () => {
    const many = Array.from({ length: 60 }, (_, i) => peer({ userId: String(i), msgToThem: 100 - i }));
    const graph = socialGraph(many, [], { threshold: 1, maxNodes: 40 });
    expect(graph.nodes).toHaveLength(41); // you + 40
  });
});

describe("reactionBalance", () => {
  test("keeps peers with enough reactions, sorted by total", () => {
    const out = reactionBalance([
      peer({ userId: "1", label: "ana", reactionsToThem: 5, reactionsFromThem: 1 }),
      peer({ userId: "2", label: "bo", reactionsToThem: 1, reactionsFromThem: 1 }), // under the floor
      peer({ userId: "3", label: "cy", reactionsToThem: 2, reactionsFromThem: 9 }),
    ]);
    expect(out.map((r) => r.userId)).toEqual(["3", "1"]);
    expect(out[0]).toMatchObject({ given: 2, received: 9 });
  });
});
