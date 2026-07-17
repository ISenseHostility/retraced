import { tokenize } from "../util/tokenize";
import type { DailyRow, HourlyRow, MessageRow, PeerRow, RetracedDatabase, SearchPosting, SessionRow, VoiceRow } from "./schema";

/**
 * The chart read path. Every query is a single getAll over one store/index
 * with a key range (spec §4) — if a chart needs more than this, the schema is
 * wrong, not the chart.
 */

export async function getDailyRange(db: RetracedDatabase, from: string | null, to: string): Promise<DailyRow[]> {
  const index = db.transaction("daily").store.index("date");
  return from === null ? index.getAll() : index.getAll(IDBKeyRange.bound(from, to));
}

export async function getHourlyRange(db: RetracedDatabase, from: string | null, to: string): Promise<HourlyRow[]> {
  const store = db.transaction("hourly").store;
  return from === null ? store.getAll() : store.getAll(IDBKeyRange.bound([from, 0], [to, 23]));
}

export async function getAllPeers(db: RetracedDatabase): Promise<PeerRow[]> {
  return db.getAll("peers");
}

export async function getAllVoice(db: RetracedDatabase): Promise<VoiceRow[]> {
  return db.getAll("voice");
}

export async function getSessionRange(db: RetracedDatabase, from: string | null, to: string): Promise<SessionRow[]> {
  const store = db.transaction("sessions").store;
  return from === null ? store.getAll() : store.getAll(IDBKeyRange.bound(from, to));
}

export interface StoreStats {
  name: string;
  rows: number;
  /** sampled estimate — first rows' JSON size × count */
  approxBytes: number;
}

const SIZE_SAMPLE = 20;

export async function getStoreStats(db: RetracedDatabase): Promise<StoreStats[]> {
  const out: StoreStats[] = [];
  for (const name of db.objectStoreNames) {
    const tx = db.transaction(name);
    const rows = await tx.store.count();
    let sampled = 0;
    let sampleBytes = 0;
    let cursor = await tx.store.openCursor();
    while (cursor && sampled < SIZE_SAMPLE) {
      try {
        sampleBytes += JSON.stringify(cursor.value)?.length ?? 0;
        sampled++;
      } catch {
        sampled++;
      }
      cursor = await cursor.continue();
    }
    out.push({ name, rows, approxBytes: sampled > 0 ? Math.round((sampleBytes / sampled) * rows) : 0 });
  }
  return out.sort((a, b) => b.approxBytes - a.approxBytes);
}

export async function getAllEmoji(db: RetracedDatabase) {
  return db.getAll("emoji");
}

export async function getAllDomains(db: RetracedDatabase) {
  return db.getAll("domains");
}

/** Top words or bigram "phrases" for one content-rule scope, via the count index (descending cursor). */
export async function getTopTerms(
  db: RetracedDatabase,
  scope: "mine" | "theirs",
  opts: { kind: "word" | "phrase"; limit: number; skip?: (term: string) => boolean }
): Promise<Array<{ term: string; count: number }>> {
  const index = db.transaction("words").store.index("byCount");
  const range = IDBKeyRange.bound([scope, 0], [scope, Number.MAX_SAFE_INTEGER]);
  const out: Array<{ term: string; count: number }> = [];
  let cursor = await index.openCursor(range, "prev");
  while (cursor && out.length < opts.limit) {
    const row = cursor.value;
    const isPhrase = row.term.includes(" ");
    if ((opts.kind === "phrase") === isPhrase && !(opts.skip?.(row.term) ?? false)) {
      out.push({ term: row.term, count: row.count });
    }
    cursor = await cursor.continue();
  }
  return out;
}

export interface SearchOptions {
  query: string;
  fromTs?: number;
  toTs?: number;
  channelId?: string;
  limit?: number;
}

const PREFIX_SCAN_CAP = 20_000;

/**
 * Full-text search over the inverted index. All terms must match (AND); the
 * trailing term matches as a prefix unless the query ends in whitespace.
 * Only content-storable messages were ever indexed, so the content rule
 * scopes results automatically.
 */
export async function searchMessages(db: RetracedDatabase, opts: SearchOptions): Promise<MessageRow[]> {
  const limit = opts.limit ?? 50;
  const trailingExact = /\s$/.test(opts.query);
  const tokens = tokenize(opts.query);
  if (tokens.length === 0) return [];
  const exact = trailingExact ? tokens : tokens.slice(0, -1);
  const prefix = trailingExact ? null : tokens[tokens.length - 1]!;

  const tx = db.transaction(["searchIndex", "messages"]);
  const index = tx.objectStore("searchIndex");

  const perTerm: Array<Map<string, SearchPosting>> = [];
  for (const term of exact) {
    const rows = await index.getAll(IDBKeyRange.bound([term], [term, "￿"]));
    perTerm.push(new Map(rows.map((r) => [r.messageId, r])));
  }
  if (prefix !== null) {
    const rows = await index.getAll(IDBKeyRange.bound([prefix], [`${prefix}￿`]), PREFIX_SCAN_CAP);
    perTerm.push(new Map(rows.map((r) => [r.messageId, r])));
  }

  perTerm.sort((a, b) => a.size - b.size);
  const matches: SearchPosting[] = [];
  for (const [messageId, posting] of perTerm[0]!) {
    if (perTerm.every((m) => m.has(messageId))) matches.push(posting);
  }

  const scoped = matches.filter(
    (p) =>
      (opts.fromTs === undefined || p.ts >= opts.fromTs) &&
      (opts.toTs === undefined || p.ts <= opts.toTs) &&
      (opts.channelId === undefined || p.channelId === opts.channelId)
  );
  scoped.sort((a, b) => b.ts - a.ts);

  const out: MessageRow[] = [];
  const messages = tx.objectStore("messages");
  for (const posting of scoped.slice(0, limit)) {
    const row = await messages.get(posting.messageId);
    if (row) out.push(row); // retention may have pruned the row — skip silently
  }
  await tx.done;
  return out;
}
