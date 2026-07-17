import { describe, expect, test } from "vitest";
import { SESSION_BUCKET_COUNT } from "../src/aggregate/buckets";
import type { HourlyRow, SessionRow } from "../src/db/schema";
import {
  SESSION_BUCKET_LABELS,
  dayHourGrid,
  hourOfDayProfile,
  nightOwlByMonth,
  sessionHistogram,
} from "../src/ui/data/rhythm";

const h = (date: string, hour: number, sent: number): HourlyRow => ({ date, hour, sent });

describe("hourOfDayProfile", () => {
  test("sums per hour across dates and finds the peak", () => {
    const profile = hourOfDayProfile([h("2026-07-15", 14, 3), h("2026-07-16", 14, 5), h("2026-07-16", 9, 4)]);
    expect(profile.hours).toHaveLength(24);
    expect(profile.hours[14]).toBe(8);
    expect(profile.hours[9]).toBe(4);
    expect(profile.total).toBe(12);
    expect(profile.peakHour).toBe(14);
  });

  test("empty input has no peak", () => {
    const profile = hourOfDayProfile([]);
    expect(profile.total).toBe(0);
    expect(profile.peakHour).toBeNull();
  });
});

describe("dayHourGrid", () => {
  test("places counts on the weekday row, Monday first", () => {
    // 2026-07-16 is a Thursday (row 3); 2026-07-20 is a Monday (row 0)
    const grid = dayHourGrid([h("2026-07-16", 14, 5), h("2026-07-20", 8, 2), h("2026-07-23", 14, 1)]);
    expect(grid.grid).toHaveLength(7);
    expect(grid.grid[0]).toHaveLength(24);
    expect(grid.grid[3]![14]).toBe(6); // two Thursdays at 14:00 accumulate
    expect(grid.grid[0]![8]).toBe(2);
    expect(grid.max).toBe(6);
    expect(grid.total).toBe(8);
  });
});

describe("nightOwlByMonth", () => {
  test("computes the night share per month and gap-fills empty months", () => {
    const rows = [
      h("2026-04-10", 23, 6), // night
      h("2026-04-10", 13, 6), // day
      ...Array.from({ length: 12 }, (_, i) => h("2026-06-05", 12, 1)), // june: all day, enough volume
    ];
    const points = nightOwlByMonth(rows);
    expect(points.map((p) => p.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(points[0]!.pct).toBe(50);
    expect(points[1]!.pct).toBeNull(); // gap month
    expect(points[2]!.pct).toBe(0);
  });

  test("months with too few messages get a null pct, not a misleading one", () => {
    const points = nightOwlByMonth([h("2026-04-10", 23, 2)]);
    expect(points).toHaveLength(1);
    expect(points[0]!.pct).toBeNull();
    expect(points[0]!.total).toBe(2);
  });

  test("hours 22–23 and 0–5 count as night", () => {
    const rows = [h("2026-04-01", 22, 1), h("2026-04-02", 2, 1), h("2026-04-03", 5, 1), h("2026-04-04", 6, 1), h("2026-04-05", 21, 1), ...Array.from({ length: 5 }, (_, i) => h("2026-04-06", 12, 1))];
    const points = nightOwlByMonth(rows);
    expect(points[0]!.pct).toBe(30); // 3 night of 10
  });
});

describe("sessionHistogram", () => {
  const row = (date: string, buckets: number[], totalMs: number): SessionRow => ({ date, buckets, totalMs });

  test("sums buckets across days and finds the median bucket", () => {
    const a = new Array(SESSION_BUCKET_COUNT).fill(0);
    a[1] = 2;
    const b = new Array(SESSION_BUCKET_COUNT).fill(0);
    b[3] = 3;
    const hist = sessionHistogram([row("2026-07-01", a, 1_200_000), row("2026-07-02", b, 9_000_000)]);
    expect(hist.total).toBe(5);
    expect(hist.buckets[1]).toBe(2);
    expect(hist.buckets[3]).toBe(3);
    expect(hist.medianBucket).toBe(3); // counts 2,3 → the 3rd of 5 sits in bucket 3
    expect(hist.totalMs).toBe(10_200_000);
  });

  test("empty input has no median", () => {
    const hist = sessionHistogram([]);
    expect(hist.total).toBe(0);
    expect(hist.medianBucket).toBeNull();
  });

  test("labels cover every bucket", () => {
    expect(SESSION_BUCKET_LABELS).toHaveLength(SESSION_BUCKET_COUNT);
    expect(SESSION_BUCKET_LABELS[0]).toBe("<5m");
    expect(SESSION_BUCKET_LABELS[SESSION_BUCKET_COUNT - 1]).toBe("4h+");
  });
});
