import { describe, expect, test } from "vitest";
import type { DailyRow, HourlyRow, PeerRow } from "../src/db/schema";
import {
  calendarByYear,
  messagesPerDaySeries,
  sankeyFlows,
  serverShareWeekly,
  summaryStats,
} from "../src/ui/data/selectors";
import { mondayOf, shiftDate } from "../src/util/time";

function dailyRow(over: Partial<DailyRow>): DailyRow {
  return {
    date: "2026-07-01",
    channelId: "c1",
    guildId: "g1",
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
    deleteAfterBuckets: [0, 0, 0, 0, 0, 0, 0],
    longestBurst: 0,
    ...over,
  };
}

describe("date helpers", () => {
  test("shiftDate moves across month boundaries in local time", () => {
    expect(shiftDate("2026-07-01", -1)).toBe("2026-06-30");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("mondayOf returns the Monday of the week", () => {
    expect(mondayOf("2026-07-16")).toBe("2026-07-13"); // Thursday → Monday
    expect(mondayOf("2026-07-13")).toBe("2026-07-13"); // Monday stays
    expect(mondayOf("2026-07-19")).toBe("2026-07-13"); // Sunday belongs to the preceding Monday
  });
});

describe("messagesPerDaySeries", () => {
  test("sums channels per day, fills gaps, and computes a trailing 7-day average", () => {
    const rows = [
      dailyRow({ date: "2026-07-01", channelId: "a", sent: 4 }),
      dailyRow({ date: "2026-07-01", channelId: "b", sent: 2 }),
      dailyRow({ date: "2026-07-03", channelId: "a", sent: 12 }),
    ];
    const series = messagesPerDaySeries(rows, "2026-07-01", "2026-07-04");
    expect(series.map((p) => p.sent)).toEqual([6, 0, 12, 0]);
    expect(series.map((p) => p.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]);
    expect(series[3]!.avg7).toBeCloseTo(18 / 4, 5); // trailing mean over available window
  });

  test("empty rows produce a zero-filled range", () => {
    const series = messagesPerDaySeries([], "2026-07-01", "2026-07-03");
    expect(series).toHaveLength(3);
    expect(series.every((p) => p.sent === 0)).toBe(true);
  });
});

describe("serverShareWeekly", () => {
  const label = (id: string) => `Guild ${id}`;

  test("buckets by week with DMs first, guilds by volume, and Other folding", () => {
    const rows = [
      dailyRow({ date: "2026-07-13", guildId: "g1", sent: 10 }),
      dailyRow({ date: "2026-07-14", guildId: "g2", channelId: "c2", sent: 30 }),
      dailyRow({ date: "2026-07-15", guildId: null, channelId: "dm1", sent: 5 }),
      dailyRow({ date: "2026-07-21", guildId: "g1", sent: 7 }),
    ];
    const result = serverShareWeekly(rows, { maxGuilds: 1, guildLabel: label });
    expect(result.series.map((s) => s.key)).toEqual(["dms", "g2", "other"]);
    expect(result.series[0]!.label).toBe("DMs");
    expect(result.series[1]!.label).toBe("Guild g2");

    expect(result.weeks).toHaveLength(2);
    const week1 = result.weeks[0]!;
    expect(week1.week).toBe("2026-07-13");
    expect(week1.g2).toBe(30);
    expect(week1.dms).toBe(5);
    expect(week1.other).toBe(10); // g1 folded
    expect(result.weeks[1]).toMatchObject({ week: "2026-07-20", other: 7, dms: 0, g2: 0 });
  });

  test("series with zero totals are dropped", () => {
    const rows = [dailyRow({ date: "2026-07-13", guildId: "g1", sent: 3 })];
    const result = serverShareWeekly(rows, { maxGuilds: 5, guildLabel: label });
    expect(result.series.map((s) => s.key)).toEqual(["g1"]);
  });

  test("only own activity counts — rows with zero sent contribute nothing", () => {
    const rows = [dailyRow({ date: "2026-07-13", guildId: "g1", sent: 0, initiatedByThem: 4 })];
    const result = serverShareWeekly(rows, { maxGuilds: 5, guildLabel: label });
    expect(result.weeks).toHaveLength(0);
    expect(result.series).toHaveLength(0);
  });
});

describe("calendarByYear", () => {
  test("groups by year with quartile levels over nonzero days", () => {
    const rows = [
      dailyRow({ date: "2025-12-31", sent: 2 }),
      dailyRow({ date: "2026-01-01", sent: 1 }),
      dailyRow({ date: "2026-01-02", sent: 10 }),
      dailyRow({ date: "2026-01-02", channelId: "b", sent: 10 }),
      dailyRow({ date: "2026-01-03", sent: 40 }),
    ];
    const years = calendarByYear(rows);
    expect(years.map((y) => y.year)).toEqual([2026, 2025]); // newest first
    const y2026 = years[0]!;
    const byDate = new Map(y2026.days.map((d) => [d.date, d]));
    expect(byDate.get("2026-01-02")!.count).toBe(20);
    expect(byDate.get("2026-01-03")!.level).toBe(4); // top bin
    expect(byDate.get("2026-01-01")!.level).toBeGreaterThanOrEqual(1);
    expect(y2026.max).toBe(40);
  });

  test("no rows → empty", () => {
    expect(calendarByYear([])).toEqual([]);
  });
});

describe("sankeyFlows", () => {
  const opts = {
    maxGuilds: 2,
    channelsPerGuild: 2,
    guildLabel: (id: string) => `G-${id}`,
    channelLabel: (id: string) => `#${id}`,
  };

  test("builds You → guilds/DMs → top channels with folding", () => {
    const rows = [
      dailyRow({ guildId: "g1", channelId: "a", sent: 50 }),
      dailyRow({ guildId: "g1", channelId: "b", sent: 30 }),
      dailyRow({ guildId: "g1", channelId: "c", sent: 5 }),
      dailyRow({ guildId: "g2", channelId: "d", sent: 20 }),
      dailyRow({ guildId: null, channelId: "dm1", sent: 40 }),
    ];
    const data = sankeyFlows(rows, opts)!;
    const you = data.nodes.find((n) => n.kind === "root")!;
    expect(you.label).toBe("You");

    const g1 = data.links.find((l) => l.source === you.id && l.target === "guild:g1")!;
    expect(g1.value).toBe(85);
    const dms = data.links.find((l) => l.target === "dms")!;
    expect(dms.value).toBe(40);

    // top 2 channels of g1 named, remainder folded
    expect(data.links.find((l) => l.source === "guild:g1" && l.target === "channel:a")!.value).toBe(50);
    expect(data.links.find((l) => l.source === "guild:g1" && l.target === "channel:b")!.value).toBe(30);
    const g1Other = data.links.find((l) => l.source === "guild:g1" && l.target === "guild:g1:other");
    expect(g1Other!.value).toBe(5);

    // every non-root node's inflow equals its outflow or is terminal
    const inflow = (id: string) => data.links.filter((l) => l.target === id).reduce((n, l) => n + l.value, 0);
    const outflow = (id: string) => data.links.filter((l) => l.source === id).reduce((n, l) => n + l.value, 0);
    expect(inflow("guild:g1")).toBe(outflow("guild:g1"));
  });

  test("returns null when nothing was sent", () => {
    expect(sankeyFlows([dailyRow({ sent: 0 })], opts)).toBeNull();
  });
});

describe("summaryStats", () => {
  const hourly = (date: string, hour: number, sent: number): HourlyRow => ({ date, hour, sent });
  const peer = (over: Partial<PeerRow>): PeerRow => ({
    userId: "1",
    label: null,
    avatarHash: null,
    msgToThem: 0,
    msgFromThem: 0,
    initiatedByMe: 0,
    initiatedByThem: 0,
    latencyBucketsMine: [0, 0, 0, 0, 0, 0, 0],
    latencyBucketsTheirs: [0, 0, 0, 0, 0, 0, 0],
    typingAbortedAtThem: 0,
    reactionsToThem: 0,
    reactionsFromThem: 0,
    firstSeenTs: 0,
    lastSeenTs: 0,
    ...over,
  });

  test("computes the six cards", () => {
    const today = "2026-07-16";
    const stats = summaryStats({
      daily: [
        dailyRow({ date: "2026-07-14", sent: 10, typingCommitted: 8, typingAborted: 2, longestBurst: 9 }),
        dailyRow({ date: "2026-07-15", sent: 5, guildId: null, channelId: "dm1", initiatedByThem: 1 }),
        dailyRow({ date: "2026-07-16", sent: 3, guildId: null, channelId: "dm2", initiatedByThem: 1, longestBurst: 4 }),
      ],
      hourly: [hourly("2026-07-14", 23, 6), hourly("2026-07-14", 4, 2), hourly("2026-07-15", 14, 8)],
      peers: [peer({ userId: "p1", label: "alex", msgToThem: 40, msgFromThem: 60 }), peer({ userId: "p2", label: "sam", msgToThem: 10 })],
      streakDaily: [
        dailyRow({ date: "2026-07-14", sent: 10 }),
        dailyRow({ date: "2026-07-15", sent: 5 }),
        dailyRow({ date: "2026-07-16", sent: 3 }),
      ],
      today,
    });

    expect(stats.totalSent).toBe(18);
    expect(stats.nightOwlPct).toBe(50); // 8 of 16 hourly messages in 22:00–06:00
    expect(stats.currentStreakDays).toBe(3);
    expect(stats.longestBurst).toBe(9);
    expect(stats.mostMessaged).toEqual({ label: "alex", total: 100 });
    // dm1 day: their opener, no reply that day (sent counts channel dm1? sent=5 on that row → replied) —
    // dm2 day: their opener and sent=3 on the same row → replied. Ghost days: none of 2 → 0%
    expect(stats.ghostRatePct).toBe(0);
    expect(stats.hesitation).toEqual({ pct: 20, aborted: 2, committed: 8 });
  });

  test("ghost rate counts DM days with their opener and zero replies", () => {
    const stats = summaryStats({
      daily: [
        dailyRow({ date: "2026-07-10", guildId: null, channelId: "dm1", initiatedByThem: 1, sent: 0 }),
        dailyRow({ date: "2026-07-11", guildId: null, channelId: "dm1", initiatedByThem: 1, sent: 2 }),
        dailyRow({ date: "2026-07-12", guildId: "g1", initiatedByThem: 1, sent: 0 }), // guild rows don't count
      ],
      hourly: [],
      peers: [],
      streakDaily: [],
      today: "2026-07-16",
    });
    expect(stats.ghostRatePct).toBe(50);
  });

  test("streak of zero when today and yesterday are silent; streak may end yesterday", () => {
    const base = { daily: [], hourly: [], peers: [], today: "2026-07-16" };
    expect(summaryStats({ ...base, streakDaily: [dailyRow({ date: "2026-07-10", sent: 1 })] }).currentStreakDays).toBe(0);
    expect(
      summaryStats({
        ...base,
        streakDaily: [dailyRow({ date: "2026-07-15", sent: 1 }), dailyRow({ date: "2026-07-14", sent: 2 })],
      }).currentStreakDays
    ).toBe(2);
  });

  test("empty data yields calm nulls, not NaN", () => {
    const stats = summaryStats({ daily: [], hourly: [], peers: [], streakDaily: [], today: "2026-07-16" });
    expect(stats.nightOwlPct).toBeNull();
    expect(stats.hesitation).toBeNull();
    expect(stats.mostMessaged).toBeNull();
    expect(stats.ghostRatePct).toBeNull();
    expect(stats.totalSent).toBe(0);
  });
});
