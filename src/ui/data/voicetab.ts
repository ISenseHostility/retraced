import type { PeerRow, VoiceRow } from "../../db/schema";
import { mondayOf, shiftDate } from "../../util/time";

/** Voice-tab shaping: the voice rollup → minutes lines, chord matrix, top channels. */

const MAX_WEEKS = 800;

export interface VoiceWeek {
  week: string;
  minutes: number;
}

export function voiceMinutesWeekly(rows: VoiceRow[]): VoiceWeek[] {
  const byWeek = new Map<string, number>();
  for (const row of rows) {
    if (row.seconds <= 0) continue;
    const week = mondayOf(row.date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + row.seconds);
  }
  if (byWeek.size === 0) return [];

  const weeks = [...byWeek.keys()].sort();
  const last = weeks[weeks.length - 1]!;
  const out: VoiceWeek[] = [];
  let cursor = weeks[0]!;
  for (let i = 0; i < MAX_WEEKS; i++) {
    out.push({ week: cursor, minutes: Math.round((byWeek.get(cursor) ?? 0) / 60) });
    if (cursor === last) break;
    cursor = shiftDate(cursor, 7);
  }
  return out;
}

export interface ChordData {
  /** entity 0 is always "you" */
  names: string[];
  /** symmetric shared-minutes matrix */
  matrix: number[][];
}

/**
 * Who you actually share voice time with. You↔peer weights are exact; peer↔peer
 * weights approximate co-occurrence as min(shared seconds) per channel-day.
 */
export function voiceChord(rows: VoiceRow[], peers: PeerRow[], opts: { max?: number } = {}): ChordData | null {
  const max = opts.max ?? 8;

  const withYou = new Map<string, number>();
  for (const row of rows) {
    for (const [userId, seconds] of Object.entries(row.coPresent)) {
      withYou.set(userId, (withYou.get(userId) ?? 0) + seconds);
    }
  }
  if (withYou.size === 0) return null;

  const kept = [...withYou.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  const indexOf = new Map(kept.map(([userId], i) => [userId, i + 1]));
  const labelOf = new Map(peers.map((p) => [p.userId, p.label ?? p.userId]));

  const n = kept.length + 1;
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const [userId, seconds] of kept) {
    const i = indexOf.get(userId)!;
    matrix[0]![i] = Math.round(seconds / 60);
    matrix[i]![0] = matrix[0]![i]!;
  }
  for (const row of rows) {
    const present = Object.entries(row.coPresent).filter(([userId]) => indexOf.has(userId));
    for (let a = 0; a < present.length; a++) {
      for (let b = a + 1; b < present.length; b++) {
        const [ua, sa] = present[a]!;
        const [ub, sb] = present[b]!;
        const [i, j] = [indexOf.get(ua)!, indexOf.get(ub)!];
        const minutes = Math.round(Math.min(sa, sb) / 60);
        matrix[i]![j] = (matrix[i]![j] ?? 0) + minutes;
        matrix[j]![i] = matrix[i]![j]!;
      }
    }
  }

  return {
    names: ["you", ...kept.map(([userId]) => labelOf.get(userId) ?? userId)],
    matrix,
  };
}

export interface VcChannelRow {
  channelId: string;
  label: string;
  minutes: number;
}

export function topVcChannels(rows: VoiceRow[], opts: { channelLabel: (channelId: string) => string; max?: number }): VcChannelRow[] {
  const byChannel = new Map<string, number>();
  for (const row of rows) {
    if (row.seconds <= 0) continue;
    byChannel.set(row.channelId, (byChannel.get(row.channelId) ?? 0) + row.seconds);
  }
  return [...byChannel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, opts.max ?? 10)
    .map(([channelId, seconds]) => ({ channelId, label: opts.channelLabel(channelId), minutes: Math.round(seconds / 60) }));
}
