import type { DailyRow, HourlyRow, PeerRow } from "../../db/schema";
import { mondayOf, shiftDate } from "../../util/time";

/**
 * Pure shaping: rollup rows → chart props. No DB access, no Discord access —
 * label resolution comes in as functions. Charts stay presentational.
 */

const MAX_RANGE_DAYS = 5_000; // loop guard for malformed ranges

// ---------------------------------------------------------------- messages/day

export interface DayPoint {
  date: string;
  sent: number;
  avg7: number;
}

export function messagesPerDaySeries(rows: DailyRow[], from: string, to: string): DayPoint[] {
  if (from > to) return [];
  const byDate = new Map<string, number>();
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.sent);

  const out: DayPoint[] = [];
  const window: number[] = [];
  let windowSum = 0;
  let cursor = from;
  for (let i = 0; i < MAX_RANGE_DAYS; i++) {
    const sent = byDate.get(cursor) ?? 0;
    window.push(sent);
    windowSum += sent;
    if (window.length > 7) windowSum -= window.shift()!;
    out.push({ date: cursor, sent, avg7: windowSum / window.length });
    if (cursor === to) break;
    cursor = shiftDate(cursor, 1);
  }
  return out;
}

// ---------------------------------------------------------------- streamgraph

export interface StreamSeries {
  key: string;
  label: string;
  /** palette slot; 0 = DMs, 1.. = guilds by volume, -1 = the "Other" fold */
  colorSlot: number;
}

export interface StreamResult {
  weeks: Array<{ week: string } & Record<string, number | string>>;
  series: StreamSeries[];
}

/** Stable slot order so a guild keeps its color across range switches (color follows the entity). */
export function guildSlotOrder(allRows: DailyRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of allRows) {
    if (row.guildId !== null && row.sent > 0) totals.set(row.guildId, (totals.get(row.guildId) ?? 0) + row.sent);
  }
  const order = new Map<string, number>();
  [...totals.entries()].sort((a, b) => b[1] - a[1]).forEach(([guildId], i) => order.set(guildId, i + 1));
  return order;
}

export function serverShareWeekly(
  rows: DailyRow[],
  opts: { maxGuilds?: number; guildLabel: (guildId: string) => string; slotFor?: (guildId: string) => number }
): StreamResult {
  const maxGuilds = opts.maxGuilds ?? 5;
  const totals = new Map<string, number>();
  const cells = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (row.sent <= 0) continue;
    const key = row.guildId ?? "dms";
    const week = mondayOf(row.date);
    totals.set(key, (totals.get(key) ?? 0) + row.sent);
    let weekCells = cells.get(week);
    if (!weekCells) cells.set(week, (weekCells = new Map()));
    weekCells.set(key, (weekCells.get(key) ?? 0) + row.sent);
  }

  if (cells.size === 0) return { weeks: [], series: [] };

  const guildTotals = [...totals.entries()].filter(([key]) => key !== "dms").sort((a, b) => b[1] - a[1]);
  const topGuilds = guildTotals.slice(0, maxGuilds).map(([key]) => key);
  const hasOther = guildTotals.length > topGuilds.length;

  const series: StreamSeries[] = [];
  if ((totals.get("dms") ?? 0) > 0) series.push({ key: "dms", label: "DMs", colorSlot: 0 });
  topGuilds.forEach((guildId, i) =>
    series.push({ key: guildId, label: opts.guildLabel(guildId), colorSlot: opts.slotFor?.(guildId) ?? i + 1 })
  );
  if (hasOther) series.push({ key: "other", label: "Other servers", colorSlot: -1 });

  const weekKeys = [...cells.keys()].sort();
  const first = weekKeys[0]!;
  const last = weekKeys[weekKeys.length - 1]!;
  const topSet = new Set(topGuilds);

  const weeks: StreamResult["weeks"] = [];
  let cursor = first;
  for (let i = 0; i < MAX_RANGE_DAYS / 7; i++) {
    const weekCells = cells.get(cursor);
    const entry: { week: string } & Record<string, number | string> = { week: cursor };
    for (const s of series) entry[s.key] = 0;
    if (weekCells) {
      for (const [key, sent] of weekCells) {
        const target = key === "dms" ? "dms" : topSet.has(key) ? key : "other";
        if (target in entry) entry[target] = (entry[target] as number) + sent;
      }
    }
    weeks.push(entry);
    if (cursor === last) break;
    cursor = shiftDate(cursor, 7);
  }
  return { weeks, series };
}

// ---------------------------------------------------------------- calendar

export interface CalendarDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface CalendarYear {
  year: number;
  days: CalendarDay[];
  max: number;
}

export function calendarByYear(rows: DailyRow[]): CalendarYear[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (row.sent <= 0) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.sent);
  }
  if (byDate.size === 0) return [];

  // thresholds pooled across all years so levels are comparable
  const sorted = [...byDate.values()].sort((a, b) => a - b);
  const q = (f: number): number => sorted[Math.floor(f * (sorted.length - 1))]!;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const level = (count: number): CalendarDay["level"] =>
    count <= 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4;

  const years = new Map<number, CalendarYear>();
  for (const [date, count] of byDate) {
    const year = Number(date.slice(0, 4));
    let entry = years.get(year);
    if (!entry) years.set(year, (entry = { year, days: [], max: 0 }));
    entry.days.push({ date, count, level: level(count) });
    entry.max = Math.max(entry.max, count);
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}

// ---------------------------------------------------------------- sankey

export interface SankeyNode {
  id: string;
  label: string;
  kind: "root" | "guild" | "dms" | "channel" | "other";
  colorSlot: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: Array<{ source: string; target: string; value: number }>;
}

export function sankeyFlows(
  rows: DailyRow[],
  opts: {
    maxGuilds?: number;
    channelsPerGuild?: number;
    guildLabel: (guildId: string) => string;
    channelLabel: (channelId: string) => string;
    slotFor?: (guildId: string) => number;
  }
): SankeyData | null {
  const maxGuilds = opts.maxGuilds ?? 5;
  const channelsPerGuild = opts.channelsPerGuild ?? 3;

  const groupTotals = new Map<string, number>(); // guildId | "dms"
  const channelTotals = new Map<string, Map<string, number>>(); // group -> channelId -> sent
  let totalSent = 0;

  for (const row of rows) {
    if (row.sent <= 0) continue;
    totalSent += row.sent;
    const group = row.guildId ?? "dms";
    groupTotals.set(group, (groupTotals.get(group) ?? 0) + row.sent);
    let channels = channelTotals.get(group);
    if (!channels) channelTotals.set(group, (channels = new Map()));
    channels.set(row.channelId, (channels.get(row.channelId) ?? 0) + row.sent);
  }
  if (totalSent === 0) return null;

  const nodes: SankeyNode[] = [{ id: "you", label: "You", kind: "root", colorSlot: -2 }];
  const links: SankeyData["links"] = [];

  const guildEntries = [...groupTotals.entries()].filter(([g]) => g !== "dms").sort((a, b) => b[1] - a[1]);
  const named = guildEntries.slice(0, maxGuilds);
  const foldedGuilds = guildEntries.slice(maxGuilds);

  const addChannelLayer = (groupId: string, nodeId: string, colorSlot: number): void => {
    const channels = [...(channelTotals.get(groupId) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
    const top = channels.slice(0, channelsPerGuild);
    const rest = channels.slice(channelsPerGuild).reduce((n, [, v]) => n + v, 0);
    for (const [channelId, value] of top) {
      nodes.push({ id: `channel:${channelId}`, label: opts.channelLabel(channelId), kind: "channel", colorSlot });
      links.push({ source: nodeId, target: `channel:${channelId}`, value });
    }
    if (rest > 0) {
      nodes.push({ id: `${nodeId}:other`, label: groupId === "dms" ? "other DMs" : "everything else", kind: "other", colorSlot });
      links.push({ source: nodeId, target: `${nodeId}:other`, value: rest });
    }
  };

  const dmsTotal = groupTotals.get("dms") ?? 0;
  if (dmsTotal > 0) {
    nodes.push({ id: "dms", label: "DMs", kind: "dms", colorSlot: 0 });
    links.push({ source: "you", target: "dms", value: dmsTotal });
    addChannelLayer("dms", "dms", 0);
  }

  named.forEach(([guildId, value], i) => {
    const nodeId = `guild:${guildId}`;
    const slot = opts.slotFor?.(guildId) ?? i + 1;
    nodes.push({ id: nodeId, label: opts.guildLabel(guildId), kind: "guild", colorSlot: slot });
    links.push({ source: "you", target: nodeId, value });
    addChannelLayer(guildId, nodeId, slot);
  });

  if (foldedGuilds.length > 0) {
    const value = foldedGuilds.reduce((n, [, v]) => n + v, 0);
    nodes.push({ id: "guilds:other", label: "Other servers", kind: "other", colorSlot: -1 });
    links.push({ source: "you", target: "guilds:other", value });
  }

  return { nodes, links };
}

// ---------------------------------------------------------------- summary cards

export interface SummaryStats {
  totalSent: number;
  nightOwlPct: number | null;
  currentStreakDays: number;
  longestBurst: number;
  mostMessaged: { label: string; total: number } | null;
  ghostRatePct: number | null;
  hesitation: { pct: number; aborted: number; committed: number } | null;
}

/** The single definition of "night" — shared with the Rhythm tab. */
export const isNightHour = (hour: number): boolean => hour >= 22 || hour < 6;

export function summaryStats(input: {
  daily: DailyRow[];
  hourly: HourlyRow[];
  peers: PeerRow[];
  streakDaily: DailyRow[];
  today: string;
}): SummaryStats {
  const totalSent = input.daily.reduce((n, r) => n + r.sent, 0);

  let nightSent = 0;
  let hourlyTotal = 0;
  for (const row of input.hourly) {
    hourlyTotal += row.sent;
    if (isNightHour(row.hour)) nightSent += row.sent;
  }

  const activeDates = new Set(input.streakDaily.filter((r) => r.sent > 0).map((r) => r.date));
  let streak = 0;
  let cursor = activeDates.has(input.today) ? input.today : shiftDate(input.today, -1);
  while (activeDates.has(cursor)) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }

  const longestBurst = input.daily.reduce((n, r) => Math.max(n, r.longestBurst ?? 0), 0);

  let mostMessaged: SummaryStats["mostMessaged"] = null;
  for (const peer of input.peers) {
    const total = peer.msgToThem + peer.msgFromThem;
    if (total > 0 && total > (mostMessaged?.total ?? 0)) {
      mostMessaged = { label: peer.label ?? peer.userId, total };
    }
  }

  // ghost rate: DM/group days where they opened a conversation and you sent nothing back that day
  let openerDays = 0;
  let ghostedDays = 0;
  for (const row of input.daily) {
    if (row.guildId !== null || row.initiatedByThem <= 0) continue;
    openerDays++;
    if (row.sent === 0) ghostedDays++;
  }

  const aborted = input.daily.reduce((n, r) => n + r.typingAborted, 0);
  const committed = input.daily.reduce((n, r) => n + r.typingCommitted, 0);

  return {
    totalSent,
    nightOwlPct: hourlyTotal > 0 ? Math.round((100 * nightSent) / hourlyTotal) : null,
    currentStreakDays: streak,
    longestBurst,
    mostMessaged,
    ghostRatePct: openerDays > 0 ? Math.round((100 * ghostedDays) / openerDays) : null,
    hesitation: aborted + committed > 0 ? { pct: Math.round((100 * aborted) / (aborted + committed)), aborted, committed } : null,
  };
}
