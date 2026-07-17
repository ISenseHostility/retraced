import { LENGTH_BUCKET_COUNT } from "../../aggregate/buckets";
import type { ContentTypeFlags } from "../../capture/types";
import type { DailyRow, DomainRow, EmojiRow } from "../../db/schema";
import { mondayOf, shiftDate } from "../../util/time";
import { sumInto } from "./histogram";

/**
 * Content-tab shaping. Scope discipline matters here: "mine" spans every
 * channel, "theirs" is DM/group-DM only (the content rule) — charts label
 * this instead of silently mixing.
 */

const MAX_WEEKS = 800;

// ---------------------------------------------------------------- content types

export interface TypeSlice {
  key: keyof ContentTypeFlags;
  label: string;
  count: number;
  /** fixed per type — color follows the entity, never the rank */
  colorSlot: number;
}

const TYPE_ORDER: Array<{ key: keyof ContentTypeFlags; label: string }> = [
  { key: "text", label: "Text" },
  { key: "image", label: "Images" },
  { key: "link", label: "Links" },
  { key: "gif", label: "GIFs" },
  { key: "sticker", label: "Stickers" },
  { key: "attachment", label: "Attachments" },
];

export function contentTypeSplit(rows: DailyRow[]): { slices: TypeSlice[]; total: number } {
  const sums = new Map<keyof ContentTypeFlags, number>();
  for (const row of rows) {
    for (const { key } of TYPE_ORDER) sums.set(key, (sums.get(key) ?? 0) + row.contentTypes[key]);
  }
  const slices: TypeSlice[] = [];
  let total = 0;
  TYPE_ORDER.forEach(({ key, label }, slot) => {
    const count = sums.get(key) ?? 0;
    total += count;
    if (count > 0) slices.push({ key, label, count, colorSlot: slot });
  });
  return { slices, total };
}

// ---------------------------------------------------------------- domains

export function topDomains(rows: DomainRow[], max = 10): Array<{ domain: string; count: number }> {
  return [...rows]
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((r) => ({ domain: r.domain, count: r.count }));
}

// ---------------------------------------------------------------- custom emoji

export interface EmojiGroup {
  scope: string;
  label: string;
  emoji: Array<{ emojiId: string; name: string; count: number }>;
}

export function emojiByServer(rows: EmojiRow[], opts: { guildLabel: (guildId: string) => string; perServer?: number }): EmojiGroup[] {
  const groups = new Map<string, EmojiGroup & { total: number }>();
  for (const row of rows) {
    if (row.count <= 0) continue;
    let group = groups.get(row.guildScope);
    if (!group) {
      groups.set(
        row.guildScope,
        (group = { scope: row.guildScope, label: row.guildScope === "dm" ? "DMs" : opts.guildLabel(row.guildScope), emoji: [], total: 0 })
      );
    }
    group.emoji.push({ emojiId: row.emojiId, name: row.name, count: row.count });
    group.total += row.count;
  }
  return [...groups.values()]
    .sort((a, b) => b.total - a.total)
    .map(({ total: _total, ...group }) => ({
      ...group,
      emoji: group.emoji.sort((a, b) => b.count - a.count).slice(0, opts.perServer ?? 10),
    }));
}

// ---------------------------------------------------------------- vocabulary richness

export interface VocabWeek {
  week: string;
  /** % of words that were new that day (weekly aggregate); null = below the floor */
  minePct: number | null;
  theirsPct: number | null;
}

/** Fewer words than this in a week and the ratio is noise. */
const MIN_WEEK_WORDS = 50;

export function vocabRichnessWeekly(rows: DailyRow[]): VocabWeek[] {
  const byWeek = new Map<string, { words: number; unique: number; theirWords: number; theirUnique: number }>();
  for (const row of rows) {
    if (row.words === 0 && (row.theirWords ?? 0) === 0) continue;
    const week = mondayOf(row.date);
    const entry = byWeek.get(week) ?? { words: 0, unique: 0, theirWords: 0, theirUnique: 0 };
    entry.words += row.words;
    entry.unique += row.uniqueWords;
    entry.theirWords += row.theirWords ?? 0;
    entry.theirUnique += row.theirUniqueWords ?? 0;
    byWeek.set(week, entry);
  }
  if (byWeek.size === 0) return [];

  const weeks = [...byWeek.keys()].sort();
  const last = weeks[weeks.length - 1]!;
  const out: VocabWeek[] = [];
  let cursor = weeks[0]!;
  for (let i = 0; i < MAX_WEEKS; i++) {
    const entry = byWeek.get(cursor);
    out.push({
      week: cursor,
      minePct: entry && entry.words >= MIN_WEEK_WORDS ? Math.round((100 * entry.unique) / entry.words) : null,
      theirsPct: entry && entry.theirWords >= MIN_WEEK_WORDS ? Math.round((100 * entry.theirUnique) / entry.theirWords) : null,
    });
    if (cursor === last) break;
    cursor = shiftDate(cursor, 7);
  }
  return out;
}

// ---------------------------------------------------------------- message length bands

export const LENGTH_BUCKET_LABELS = ["<10", "10–50", "50–200", "200–1k", "1k+"];

export interface LengthWeek {
  week: string;
  /** percentage share per band, summing to 100 (all zero when the week is empty) */
  shares: number[];
  total: number;
}

export function lengthShareWeekly(rows: DailyRow[], side: "mine" | "theirs"): LengthWeek[] {
  const byWeek = new Map<string, number[]>();
  for (const row of rows) {
    const buckets = side === "mine" ? row.lengthBuckets : row.theirLengthBuckets;
    if (!buckets || buckets.every((n) => n === 0)) continue;
    const week = mondayOf(row.date);
    let entry = byWeek.get(week);
    if (!entry) byWeek.set(week, (entry = new Array<number>(LENGTH_BUCKET_COUNT).fill(0)));
    sumInto(entry, buckets);
  }
  if (byWeek.size === 0) return [];

  const weeks = [...byWeek.keys()].sort();
  const last = weeks[weeks.length - 1]!;
  const out: LengthWeek[] = [];
  let cursor = weeks[0]!;
  for (let i = 0; i < MAX_WEEKS; i++) {
    const buckets = byWeek.get(cursor) ?? new Array<number>(LENGTH_BUCKET_COUNT).fill(0);
    const total = buckets.reduce((a, b) => a + b, 0);
    out.push({
      week: cursor,
      total,
      shares: buckets.map((n) => (total === 0 ? 0 : Math.round(((100 * n) / total) * 10) / 10)),
    });
    if (cursor === last) break;
    cursor = shiftDate(cursor, 7);
  }
  return out;
}
