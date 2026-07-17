import { SESSION_BUCKET_COUNT } from "../../aggregate/buckets";
import type { HourlyRow, SessionRow } from "../../db/schema";
import { parseDateKey } from "../../util/time";
import { medianBucket, sumInto } from "./histogram";
import { isNightHour } from "./selectors";

/**
 * Rhythm-tab shaping: hourly + session rollups → chart props. Pure functions,
 * no DB, no Discord.
 */

const MAX_MONTHS = 600; // loop guard for malformed month ranges

export interface HourProfile {
  /** length 24 — own messages sent per hour of day */
  hours: number[];
  total: number;
  peakHour: number | null;
}

export function hourOfDayProfile(rows: HourlyRow[]): HourProfile {
  const hours = new Array<number>(24).fill(0);
  let total = 0;
  for (const row of rows) {
    hours[row.hour]! += row.sent;
    total += row.sent;
  }
  let peakHour: number | null = null;
  if (total > 0) {
    peakHour = 0;
    for (let h = 1; h < 24; h++) if (hours[h]! > hours[peakHour]!) peakHour = h;
  }
  return { hours, total, peakHour };
}

export interface DayHourGrid {
  /** [7][24], Monday first */
  grid: number[][];
  max: number;
  total: number;
}

export function dayHourGrid(rows: HourlyRow[]): DayHourGrid {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  let total = 0;
  for (const row of rows) {
    const weekday = (parseDateKey(row.date).getDay() + 6) % 7;
    const cell = (grid[weekday]![row.hour]! += row.sent);
    if (cell > max) max = cell;
    total += row.sent;
  }
  return { grid, max, total };
}

export interface MonthNightPoint {
  /** YYYY-MM */
  month: string;
  /** null = not enough messages that month to mean anything */
  pct: number | null;
  total: number;
}

const MIN_MONTH_MESSAGES = 10;

function nextMonth(month: string): string {
  let year = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7)) + 1;
  if (m > 12) {
    m = 1;
    year++;
  }
  return `${year}-${String(m).padStart(2, "0")}`;
}

export function nightOwlByMonth(rows: HourlyRow[]): MonthNightPoint[] {
  const byMonth = new Map<string, { night: number; total: number }>();
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const entry = byMonth.get(month) ?? { night: 0, total: 0 };
    entry.total += row.sent;
    if (isNightHour(row.hour)) entry.night += row.sent;
    byMonth.set(month, entry);
  }
  if (byMonth.size === 0) return [];

  const months = [...byMonth.keys()].sort();
  const last = months[months.length - 1]!;
  const out: MonthNightPoint[] = [];
  let cursor = months[0]!;
  for (let i = 0; i < MAX_MONTHS; i++) {
    const entry = byMonth.get(cursor);
    const total = entry?.total ?? 0;
    out.push({
      month: cursor,
      total,
      pct: entry && total >= MIN_MONTH_MESSAGES ? Math.round((100 * entry.night) / total) : null,
    });
    if (cursor === last) break;
    cursor = nextMonth(cursor);
  }
  return out;
}

export const SESSION_BUCKET_LABELS = ["<5m", "5–15m", "15–30m", "30m–1h", "1–2h", "2–4h", "4h+"];

export interface SessionHistogram {
  buckets: number[];
  total: number;
  medianBucket: number | null;
  totalMs: number;
}

export function sessionHistogram(rows: SessionRow[]): SessionHistogram {
  const buckets = new Array<number>(SESSION_BUCKET_COUNT).fill(0);
  let totalMs = 0;
  for (const row of rows) {
    sumInto(buckets, row.buckets);
    totalMs += row.totalMs;
  }
  return {
    buckets,
    total: buckets.reduce((a, b) => a + b, 0),
    medianBucket: medianBucket(buckets),
    totalMs,
  };
}
