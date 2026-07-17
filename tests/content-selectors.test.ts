import { describe, expect, test } from "vitest";
import { DELETE_BUCKET_COUNT, LENGTH_BUCKET_COUNT } from "../src/aggregate/buckets";
import type { DailyRow, EmojiRow, PeerRow, VoiceRow } from "../src/db/schema";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  LENGTH_BUCKET_LABELS,
  contentTypeSplit,
  emojiByServer,
  lengthShareWeekly,
  topDomains,
  vocabRichnessWeekly,
} from "../src/ui/data/content";
import { topVcChannels, voiceChord, voiceMinutesWeekly } from "../src/ui/data/voicetab";

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

const voiceRow = (over: Partial<VoiceRow>): VoiceRow => ({
  date: "2026-07-16",
  channelId: "vc1",
  guildId: "g1",
  seconds: 600,
  coPresent: {},
  ...over,
});

const peer = (userId: string, label: string): PeerRow => ({
  userId,
  label,
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
});

describe("settings", () => {
  test("ship a non-empty default stopword list", () => {
    expect(DEFAULT_SETTINGS.stopWords.length).toBeGreaterThan(20);
    expect(DEFAULT_SETTINGS.stopWords).toContain("the");
  });
});

describe("contentTypeSplit", () => {
  test("sums flags across rows, keeps only present types, slots stay fixed", () => {
    const out = contentTypeSplit([
      daily({ contentTypes: { text: 5, image: 2, link: 0, gif: 0, sticker: 0, attachment: 0 } }),
      daily({ date: "2026-07-15", contentTypes: { text: 3, image: 0, link: 1, gif: 0, sticker: 0, attachment: 0 } }),
    ]);
    expect(out.total).toBe(11);
    expect(out.slices.map((s) => [s.key, s.count])).toEqual([
      ["text", 8],
      ["image", 2],
      ["link", 1],
    ]);
    // color follows the type, not the rank: link is slot 2 even when image is missing
    const link = out.slices.find((s) => s.key === "link")!;
    expect(link.colorSlot).toBe(2);
  });
});

describe("topDomains", () => {
  test("sorts by count and caps", () => {
    const rows = [
      { domain: "a.com", count: 5, lastTs: 0 },
      { domain: "b.com", count: 9, lastTs: 0 },
      { domain: "c.com", count: 1, lastTs: 0 },
    ];
    expect(topDomains(rows, 2).map((d) => d.domain)).toEqual(["b.com", "a.com"]);
  });
});

describe("emojiByServer", () => {
  const rows: EmojiRow[] = [
    { guildScope: "g1", emojiId: "1", name: "pog", count: 9 },
    { guildScope: "g1", emojiId: "2", name: "kek", count: 4 },
    { guildScope: "dm", emojiId: "3", name: "heart", count: 6 },
    { guildScope: "g2", emojiId: "4", name: "sad", count: 0 }, // net zero — dropped
  ];

  test("groups by scope, labels DMs, sorts groups by volume", () => {
    const out = emojiByServer(rows, { guildLabel: (id) => `Server ${id}` });
    expect(out.map((g) => g.label)).toEqual(["Server g1", "DMs"]);
    expect(out[0]!.emoji.map((e) => e.name)).toEqual(["pog", "kek"]);
  });

  test("caps emoji per server", () => {
    const out = emojiByServer(rows, { guildLabel: (id) => id, perServer: 1 });
    expect(out[0]!.emoji).toHaveLength(1);
  });
});

describe("vocabRichnessWeekly", () => {
  test("computes both sides weekly with a words floor, gap-filling weeks", () => {
    const out = vocabRichnessWeekly([
      daily({ date: "2026-06-29", words: 100, uniqueWords: 40, theirWords: 10, theirUniqueWords: 9 }),
      daily({ date: "2026-07-13", words: 200, uniqueWords: 50, theirWords: 100, theirUniqueWords: 30 }),
    ]);
    expect(out.map((w) => w.week)).toEqual(["2026-06-29", "2026-07-06", "2026-07-13"]);
    expect(out[0]!.minePct).toBe(40);
    expect(out[0]!.theirsPct).toBeNull(); // only 10 of their words that week — below the floor
    expect(out[1]!.minePct).toBeNull(); // gap week
    expect(out[2]!).toMatchObject({ minePct: 25, theirsPct: 30 });
  });
});

describe("lengthShareWeekly", () => {
  test("turns weekly bucket sums into percentage shares per side", () => {
    const mine = new Array(LENGTH_BUCKET_COUNT).fill(0);
    mine[0] = 3;
    mine[2] = 1;
    const theirs = new Array(LENGTH_BUCKET_COUNT).fill(0);
    theirs[4] = 2;
    const rows = [daily({ lengthBuckets: mine, theirLengthBuckets: theirs })];

    const mineOut = lengthShareWeekly(rows, "mine");
    expect(mineOut).toHaveLength(1);
    expect(mineOut[0]!.total).toBe(4);
    expect(mineOut[0]!.shares[0]).toBe(75);
    expect(mineOut[0]!.shares[2]).toBe(25);

    const theirsOut = lengthShareWeekly(rows, "theirs");
    expect(theirsOut[0]!.shares[4]).toBe(100);
  });

  test("labels cover every band", () => {
    expect(LENGTH_BUCKET_LABELS).toHaveLength(LENGTH_BUCKET_COUNT);
  });
});

describe("voiceMinutesWeekly", () => {
  test("sums seconds per week into minutes, gap-filling", () => {
    const out = voiceMinutesWeekly([
      voiceRow({ date: "2026-06-29", seconds: 600 }),
      voiceRow({ date: "2026-06-30", channelId: "vc2", seconds: 300 }),
      voiceRow({ date: "2026-07-13", seconds: 120 }),
    ]);
    expect(out.map((w) => [w.week, w.minutes])).toEqual([
      ["2026-06-29", 15],
      ["2026-07-06", 0],
      ["2026-07-13", 2],
    ]);
  });
});

describe("voiceChord", () => {
  const peers = [peer("1", "ana"), peer("2", "bo")];

  test("builds a symmetric you-centred minutes matrix", () => {
    const chord = voiceChord(
      [
        voiceRow({ coPresent: { "1": 600, "2": 300 } }),
        voiceRow({ date: "2026-07-15", coPresent: { "1": 120 } }),
      ],
      peers
    )!;
    expect(chord.names).toEqual(["you", "ana", "bo"]);
    expect(chord.matrix[0]![1]).toBe(12); // you↔ana: (600+120)/60
    expect(chord.matrix[1]![0]).toBe(12);
    expect(chord.matrix[0]![2]).toBe(5);
    expect(chord.matrix[1]![2]).toBe(5); // ana↔bo: min(600,300)/60
    expect(chord.matrix[1]![1]).toBe(0);
  });

  test("no co-presence at all yields null", () => {
    expect(voiceChord([voiceRow({})], peers)).toBeNull();
  });
});

describe("topVcChannels", () => {
  test("sums per channel, resolves labels, caps and sorts", () => {
    const out = topVcChannels(
      [
        voiceRow({ seconds: 600 }),
        voiceRow({ date: "2026-07-15", seconds: 300 }),
        voiceRow({ channelId: "vc2", seconds: 1200 }),
      ],
      { channelLabel: (id) => `#${id}`, max: 2 }
    );
    expect(out).toEqual([
      { channelId: "vc2", label: "#vc2", minutes: 20 },
      { channelId: "vc1", label: "#vc1", minutes: 15 },
    ]);
  });
});
