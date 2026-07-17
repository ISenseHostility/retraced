import { DELETE_BUCKET_COUNT } from "../../aggregate/buckets";
import type { DailyRow, PeerRow } from "../../db/schema";
import { mondayOf, shiftDate } from "../../util/time";
import { medianBucket, sumInto } from "./histogram";

/**
 * Hesitation-tab shaping: daily + peer rollups → chart props. Pure functions,
 * no DB, no Discord. The hesitation index is aborted / (aborted + committed).
 */

const MAX_WEEKS = 800; // loop guard for malformed ranges

/** Fewer resolutions than this and a share is noise, not signal. */
const MIN_WEEK_RESOLUTIONS = 3;
const MIN_CHANNEL_RESOLUTIONS = 5;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Same-named channels in different guilds get a " · Guild" suffix so rows stay tellable-apart. */
function disambiguate<T extends { label: string; guildId: string | null }>(
  rows: T[],
  guildLabel?: (guildId: string) => string
): T[] {
  if (!guildLabel) return rows;
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  return rows.map((row) =>
    (counts.get(row.label) ?? 0) > 1 && row.guildId !== null ? { ...row, label: `${row.label} · ${guildLabel(row.guildId)}` } : row
  );
}

export interface WeekHesitation {
  /** Monday of the week */
  week: string;
  /** null = no data, or too little to mean anything (gap in the line) */
  pct: number | null;
  aborted: number;
  committed: number;
}

export function hesitationWeekly(rows: DailyRow[]): WeekHesitation[] {
  const byWeek = new Map<string, { aborted: number; committed: number }>();
  for (const row of rows) {
    if (row.typingAborted === 0 && row.typingCommitted === 0) continue;
    const week = mondayOf(row.date);
    const entry = byWeek.get(week) ?? { aborted: 0, committed: 0 };
    entry.aborted += row.typingAborted;
    entry.committed += row.typingCommitted;
    byWeek.set(week, entry);
  }
  if (byWeek.size === 0) return [];

  const weeks = [...byWeek.keys()].sort();
  const last = weeks[weeks.length - 1]!;
  const out: WeekHesitation[] = [];
  let cursor = weeks[0]!;
  for (let i = 0; i < MAX_WEEKS; i++) {
    const entry = byWeek.get(cursor) ?? { aborted: 0, committed: 0 };
    const total = entry.aborted + entry.committed;
    out.push({
      week: cursor,
      aborted: entry.aborted,
      committed: entry.committed,
      pct: total >= MIN_WEEK_RESOLUTIONS ? round1((100 * entry.aborted) / total) : null,
    });
    if (cursor === last) break;
    cursor = shiftDate(cursor, 7);
  }
  return out;
}

export interface ChannelTyping {
  channelId: string;
  guildId: string | null;
  label: string;
  aborted: number;
  committed: number;
  pct: number;
}

export function channelHesitation(
  rows: DailyRow[],
  opts: {
    channelLabel: (channelId: string) => string;
    guildLabel?: (guildId: string) => string;
    sortBy: "volume" | "rate";
    max?: number;
  }
): ChannelTyping[] {
  const byChannel = new Map<string, { guildId: string | null; aborted: number; committed: number }>();
  for (const row of rows) {
    if (row.typingAborted === 0 && row.typingCommitted === 0) continue;
    const entry = byChannel.get(row.channelId) ?? { guildId: row.guildId, aborted: 0, committed: 0 };
    entry.aborted += row.typingAborted;
    entry.committed += row.typingCommitted;
    if (entry.guildId === null && row.guildId !== null) entry.guildId = row.guildId;
    byChannel.set(row.channelId, entry);
  }

  const out: ChannelTyping[] = [];
  for (const [channelId, entry] of byChannel) {
    const total = entry.aborted + entry.committed;
    if (total < MIN_CHANNEL_RESOLUTIONS) continue;
    out.push({
      channelId,
      guildId: entry.guildId,
      label: opts.channelLabel(channelId),
      aborted: entry.aborted,
      committed: entry.committed,
      pct: round1((100 * entry.aborted) / total),
    });
  }
  const volume = (c: ChannelTyping): number => c.aborted + c.committed;
  out.sort(opts.sortBy === "rate" ? (a, b) => b.pct - a.pct || volume(b) - volume(a) : (a, b) => volume(b) - volume(a));
  return disambiguate(out.slice(0, opts.max ?? 12), opts.guildLabel);
}

export interface PeerTyping {
  userId: string;
  label: string;
  aborted: number;
}

export function peerHesitation(peers: PeerRow[], max = 10): PeerTyping[] {
  return peers
    .filter((p) => p.typingAbortedAtThem > 0)
    .sort((a, b) => b.typingAbortedAtThem - a.typingAbortedAtThem)
    .slice(0, max)
    .map((p) => ({ userId: p.userId, label: p.label ?? p.userId, aborted: p.typingAbortedAtThem }));
}

export interface ChannelRates {
  channelId: string;
  guildId: string | null;
  label: string;
  sent: number;
  editPct: number;
  deletePct: number;
}

export function editDeleteRates(
  rows: DailyRow[],
  opts: { channelLabel: (channelId: string) => string; guildLabel?: (guildId: string) => string; minSent?: number; max?: number }
): ChannelRates[] {
  const minSent = opts.minSent ?? 20;
  const byChannel = new Map<string, { guildId: string | null; sent: number; edited: number; deleted: number }>();
  for (const row of rows) {
    if (row.sent === 0 && row.edited === 0 && row.deleted === 0) continue;
    const entry = byChannel.get(row.channelId) ?? { guildId: row.guildId, sent: 0, edited: 0, deleted: 0 };
    entry.sent += row.sent;
    entry.edited += row.edited;
    entry.deleted += row.deleted;
    if (entry.guildId === null && row.guildId !== null) entry.guildId = row.guildId;
    byChannel.set(row.channelId, entry);
  }

  const out = [...byChannel.entries()]
    .filter(([, e]) => e.sent >= minSent)
    .sort((a, b) => b[1].sent - a[1].sent)
    .slice(0, opts.max ?? 10)
    .map(([channelId, e]) => ({
      channelId,
      guildId: e.guildId,
      label: opts.channelLabel(channelId),
      sent: e.sent,
      editPct: round1((100 * e.edited) / e.sent),
      deletePct: round1((100 * e.deleted) / e.sent),
    }));
  return disambiguate(out, opts.guildLabel);
}

export const DELETE_BUCKET_LABELS = ["<10s", "10–60s", "1–10m", "10m–1h", "1–6h", "6–24h", "24h+"];

export interface DeleteLifetime {
  buckets: number[];
  total: number;
  medianBucket: number | null;
}

export function deleteLifetime(rows: DailyRow[]): DeleteLifetime {
  const buckets = new Array<number>(DELETE_BUCKET_COUNT).fill(0);
  for (const row of rows) sumInto(buckets, row.deleteAfterBuckets);
  return {
    buckets,
    total: buckets.reduce((a, b) => a + b, 0),
    medianBucket: medianBucket(buckets),
  };
}
