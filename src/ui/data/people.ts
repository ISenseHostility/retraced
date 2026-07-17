import type { PeerRow, VoiceRow } from "../../db/schema";
import { medianBucket } from "./histogram";

/**
 * People-tab shaping: peer + voice rollups → chart props. The peers store is
 * all-time by design, so every People chart is all-time and says so.
 */

export const REPLY_BUCKET_LABELS = ["<10s", "10–30s", "30s–2m", "2–10m", "10m–1h", "1–6h", "6h+"];

const labelOf = (p: PeerRow): string => p.label ?? p.userId;
const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- initiator ratio

export interface InitiatorRow {
  userId: string;
  label: string;
  mine: number;
  theirs: number;
  theirSharePct: number;
}

/** Fewer conversations than this and a ratio is noise, not signal. */
const MIN_CONVERSATIONS = 3;

export function initiatorRatio(
  peers: PeerRow[],
  opts: { min?: number; max?: number; sortBy?: "total" | "them" | "me" } = {}
): InitiatorRow[] {
  const min = opts.min ?? MIN_CONVERSATIONS;
  const rows: InitiatorRow[] = [];
  for (const p of peers) {
    const total = p.initiatedByMe + p.initiatedByThem;
    if (total < min) continue;
    rows.push({
      userId: p.userId,
      label: labelOf(p),
      mine: p.initiatedByMe,
      theirs: p.initiatedByThem,
      theirSharePct: Math.round((100 * p.initiatedByThem) / total),
    });
  }
  const total = (r: InitiatorRow): number => r.mine + r.theirs;
  const sortBy = opts.sortBy ?? "total";
  rows.sort(
    sortBy === "them"
      ? (a, b) => b.theirSharePct - a.theirSharePct || total(b) - total(a)
      : sortBy === "me"
        ? (a, b) => a.theirSharePct - b.theirSharePct || total(b) - total(a)
        : (a, b) => total(b) - total(a)
  );
  return rows.slice(0, opts.max ?? 12);
}

// ---------------------------------------------------------------- reply medians

export interface ReplyMedianRow {
  userId: string;
  label: string;
  /** median reply-latency bucket index, or null when that side has no data */
  mineBucket: number | null;
  theirsBucket: number | null;
  mineCount: number;
  theirsCount: number;
}

/** Fewer latency observations than this on a side and its median is noise. */
const MIN_LATENCIES = 5;

export function replyMedians(peers: PeerRow[], opts: { min?: number; max?: number } = {}): ReplyMedianRow[] {
  const min = opts.min ?? MIN_LATENCIES;
  const rows: Array<ReplyMedianRow & { volume: number }> = [];
  for (const p of peers) {
    const mineCount = sum(p.latencyBucketsMine);
    const theirsCount = sum(p.latencyBucketsTheirs);
    if (mineCount < min && theirsCount < min) continue;
    rows.push({
      userId: p.userId,
      label: labelOf(p),
      mineBucket: mineCount > 0 ? medianBucket(p.latencyBucketsMine) : null,
      theirsBucket: theirsCount > 0 ? medianBucket(p.latencyBucketsTheirs) : null,
      mineCount,
      theirsCount,
      volume: p.msgToThem + p.msgFromThem,
    });
  }
  rows.sort((a, b) => b.volume - a.volume);
  return rows.slice(0, opts.max ?? 15).map(({ volume: _volume, ...row }) => row);
}

// ---------------------------------------------------------------- latency distribution

export interface LatencyDistRow {
  label: string;
  mine: number;
  theirs: number;
}

export function latencyDistribution(peer: PeerRow): LatencyDistRow[] {
  return REPLY_BUCKET_LABELS.map((label, i) => ({
    label,
    mine: peer.latencyBucketsMine[i] ?? 0,
    theirs: peer.latencyBucketsTheirs[i] ?? 0,
  }));
}

// ---------------------------------------------------------------- social graph

export interface GraphNode {
  id: string;
  label: string;
  /** messages both directions (drives node size) */
  volume: number;
  isYou: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  weight: number;
  kind: "dm" | "voice";
}

export function socialGraph(
  peers: PeerRow[],
  voice: VoiceRow[],
  opts: { threshold?: number; maxNodes?: number } = {}
): { nodes: GraphNode[]; links: GraphLink[] } {
  const threshold = opts.threshold ?? 10;
  const maxNodes = opts.maxNodes ?? 40;

  const kept = peers
    .map((p) => ({ p, volume: p.msgToThem + p.msgFromThem }))
    .filter(({ volume }) => volume >= threshold)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, maxNodes);

  const nodes: GraphNode[] = [{ id: "you", label: "you", volume: kept.reduce((n, k) => n + k.volume, 0), isYou: true }];
  const links: GraphLink[] = [];
  const included = new Set<string>();
  for (const { p, volume } of kept) {
    nodes.push({ id: p.userId, label: labelOf(p), volume, isYou: false });
    links.push({ source: "you", target: p.userId, weight: volume, kind: "dm" });
    included.add(p.userId);
  }

  // peer↔peer edges from voice co-presence: both present in the same channel-day
  const pairSeconds = new Map<string, number>();
  for (const row of voice) {
    const present = Object.entries(row.coPresent).filter(([userId]) => included.has(userId));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const [a, aSec] = present[i]!;
        const [b, bSec] = present[j]!;
        const key = a < b ? `${a} ${b}` : `${b} ${a}`;
        pairSeconds.set(key, (pairSeconds.get(key) ?? 0) + Math.min(aSec, bSec));
      }
    }
  }
  for (const [key, weight] of pairSeconds) {
    const sep = key.indexOf(" ");
    links.push({ source: key.slice(0, sep), target: key.slice(sep + 1), weight, kind: "voice" });
  }

  return { nodes, links };
}

// ---------------------------------------------------------------- reactions

export interface ReactionRow {
  userId: string;
  label: string;
  given: number;
  received: number;
}

const MIN_REACTIONS = 3;

export function reactionBalance(peers: PeerRow[], opts: { min?: number; max?: number } = {}): ReactionRow[] {
  const min = opts.min ?? MIN_REACTIONS;
  return peers
    .filter((p) => p.reactionsToThem + p.reactionsFromThem >= min)
    .sort((a, b) => b.reactionsToThem + b.reactionsFromThem - (a.reactionsToThem + a.reactionsFromThem))
    .slice(0, opts.max ?? 12)
    .map((p) => ({ userId: p.userId, label: labelOf(p), given: p.reactionsToThem, received: p.reactionsFromThem }));
}
