import { describe, expect, test } from "vitest";
import { DELETE_BUCKET_COUNT } from "../src/aggregate/buckets";
import type { DailyRow, PeerRow } from "../src/db/schema";
import {
  DELETE_BUCKET_LABELS,
  channelHesitation,
  deleteLifetime,
  editDeleteRates,
  hesitationWeekly,
  peerHesitation,
} from "../src/ui/data/hesitation";

function daily(over: Partial<DailyRow>): DailyRow {
  return {
    date: "2026-07-16",
    channelId: "c1",
    guildId: null,
    sent: 0,
    edited: 0,
    deleted: 0,
    chars: 0,
    words: 0,
    uniqueWords: 0,
    typingCommitted: 0,
    typingAborted: 0,
    typingMs: 0,
    dwellMs: 0,
    reactionsGiven: 0,
    reactionsReceived: 0,
    contentTypes: { text: 0, image: 0, link: 0, gif: 0, sticker: 0, attachment: 0 },
    initiatedByMe: 0,
    initiatedByThem: 0,
    deleteAfterBuckets: new Array(DELETE_BUCKET_COUNT).fill(0),
    longestBurst: 0,
    ...over,
  };
}

function peer(over: Partial<PeerRow>): PeerRow {
  return {
    userId: "200",
    label: null,
    avatarHash: null,
    msgToThem: 0,
    msgFromThem: 0,
    initiatedByMe: 0,
    initiatedByThem: 0,
    latencyBucketsMine: [],
    latencyBucketsTheirs: [],
    typingAbortedAtThem: 0,
    reactionsToThem: 0,
    reactionsFromThem: 0,
    firstSeenTs: 0,
    lastSeenTs: 0,
    ...over,
  };
}

describe("hesitationWeekly", () => {
  test("merges days into Monday-keyed weeks and computes the index", () => {
    // 2026-07-13 is a Monday; the 14th is in the same week
    const weeks = hesitationWeekly([
      daily({ date: "2026-07-13", typingAborted: 2, typingCommitted: 6 }),
      daily({ date: "2026-07-14", typingAborted: 2, typingCommitted: 2 }),
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ week: "2026-07-13", aborted: 4, committed: 8 });
    expect(weeks[0]!.pct).toBeCloseTo(33.3, 0);
  });

  test("weeks with too few resolutions become gaps, and missing weeks are filled", () => {
    const weeks = hesitationWeekly([
      daily({ date: "2026-06-29", typingAborted: 1, typingCommitted: 9 }),
      daily({ date: "2026-07-13", typingAborted: 1, typingCommitted: 1 }), // only 2 resolutions
    ]);
    expect(weeks.map((w) => w.week)).toEqual(["2026-06-29", "2026-07-06", "2026-07-13"]);
    expect(weeks[0]!.pct).toBe(10);
    expect(weeks[1]!.pct).toBeNull(); // no data at all
    expect(weeks[2]!.pct).toBeNull(); // too few to be meaningful
  });
});

describe("channelHesitation", () => {
  const rows = [
    daily({ channelId: "a", guildId: "g1", typingAborted: 8, typingCommitted: 2 }),
    daily({ date: "2026-07-15", channelId: "a", guildId: "g1", typingAborted: 2, typingCommitted: 8 }),
    daily({ channelId: "b", typingAborted: 1, typingCommitted: 19 }),
    daily({ channelId: "tiny", typingAborted: 2, typingCommitted: 1 }), // < 5 resolutions — dropped
  ];
  const label = (id: string) => `#${id}`;

  test("aggregates per channel, drops thin channels, sorts by volume", () => {
    const out = channelHesitation(rows, { channelLabel: label, sortBy: "volume" });
    expect(out.map((c) => c.channelId)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ label: "#a", guildId: "g1", aborted: 10, committed: 10, pct: 50 });
  });

  test("rate sort puts the most hesitant first", () => {
    const out = channelHesitation(rows, { channelLabel: label, sortBy: "rate" });
    expect(out.map((c) => c.channelId)).toEqual(["a", "b"]);
    expect(out[1]!.pct).toBe(5);
  });

  test("respects the max cap", () => {
    const out = channelHesitation(rows, { channelLabel: label, sortBy: "volume", max: 1 });
    expect(out).toHaveLength(1);
  });

  test("duplicate labels are disambiguated with the guild name", () => {
    const out = channelHesitation(
      [
        daily({ channelId: "g1-gen", guildId: "g1", typingAborted: 3, typingCommitted: 4 }),
        daily({ channelId: "g2-gen", guildId: "g2", typingAborted: 2, typingCommitted: 4 }),
        daily({ channelId: "dm9", typingAborted: 2, typingCommitted: 4 }),
      ],
      { channelLabel: () => "#general", sortBy: "volume", guildLabel: (g) => (g === "g1" ? "Alpha" : "Beta") }
    );
    expect(out.map((c) => c.label).sort()).toEqual(["#general", "#general · Alpha", "#general · Beta"]);
  });
});

describe("peerHesitation", () => {
  test("sorts by aborted-at count and falls back to the user id as label", () => {
    const out = peerHesitation([
      peer({ userId: "1", label: "ana", typingAbortedAtThem: 3 }),
      peer({ userId: "2", typingAbortedAtThem: 9 }),
      peer({ userId: "3", label: "zoe", typingAbortedAtThem: 0 }), // dropped
    ]);
    expect(out).toEqual([
      { userId: "2", label: "2", aborted: 9 },
      { userId: "1", label: "ana", aborted: 3 },
    ]);
  });

  test("caps at max", () => {
    const peers = Array.from({ length: 15 }, (_, i) => peer({ userId: String(i), typingAbortedAtThem: i + 1 }));
    expect(peerHesitation(peers, 10)).toHaveLength(10);
  });
});

describe("editDeleteRates", () => {
  test("computes per-channel rates over a sent floor, ordered by volume", () => {
    const out = editDeleteRates(
      [
        daily({ channelId: "a", sent: 50, edited: 5, deleted: 2 }),
        daily({ date: "2026-07-15", channelId: "a", sent: 50, edited: 5, deleted: 0 }),
        daily({ channelId: "b", sent: 200, edited: 2, deleted: 2 }),
        daily({ channelId: "thin", sent: 5, edited: 5, deleted: 5 }), // under the floor
      ],
      { channelLabel: (id) => `#${id}`, minSent: 20 }
    );
    expect(out.map((c) => c.channelId)).toEqual(["b", "a"]);
    expect(out[1]).toMatchObject({ label: "#a", sent: 100, editPct: 10, deletePct: 2 });
    expect(out[0]!.editPct).toBe(1);
  });

  test("duplicate labels are disambiguated with the guild name", () => {
    const out = editDeleteRates(
      [
        daily({ channelId: "g1-gen", guildId: "g1", sent: 30, edited: 1 }),
        daily({ channelId: "g2-gen", guildId: "g2", sent: 40, edited: 1 }),
      ],
      { channelLabel: () => "#general", minSent: 20, guildLabel: (g) => (g === "g1" ? "Alpha" : "Beta") }
    );
    expect(out.map((c) => c.label).sort()).toEqual(["#general · Alpha", "#general · Beta"]);
  });
});

describe("deleteLifetime", () => {
  test("sums buckets across rows and finds the median bucket", () => {
    const early = new Array(DELETE_BUCKET_COUNT).fill(0);
    early[0] = 3;
    const late = new Array(DELETE_BUCKET_COUNT).fill(0);
    late[4] = 2;
    const out = deleteLifetime([daily({ deleteAfterBuckets: early }), daily({ date: "2026-07-15", deleteAfterBuckets: late })]);
    expect(out.total).toBe(5);
    expect(out.medianBucket).toBe(0); // 3 of 5 deletions sit in the first bucket
  });

  test("tolerates legacy rows without buckets", () => {
    const legacy = daily({});
    (legacy as Partial<DailyRow>).deleteAfterBuckets = undefined as unknown as number[];
    expect(deleteLifetime([legacy]).total).toBe(0);
    expect(deleteLifetime([legacy]).medianBucket).toBeNull();
  });

  test("labels cover every bucket", () => {
    expect(DELETE_BUCKET_LABELS).toHaveLength(DELETE_BUCKET_COUNT);
    expect(DELETE_BUCKET_LABELS[0]).toBe("<10s");
    expect(DELETE_BUCKET_LABELS[DELETE_BUCKET_COUNT - 1]).toBe("24h+");
  });
});
