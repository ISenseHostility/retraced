import type {
  CapturedEvent,
  MessageCreatedEvent,
  ReactionEvent,
  TypingResolvedEvent,
} from "../capture/types";
import { dateKey, hourOf } from "../util/time";
import { bigrams, tokenize } from "../util/tokenize";
import {
  LENGTH_BUCKET_BOUNDS_CHARS,
  LENGTH_BUCKET_COUNT,
  REPLY_BUCKET_BOUNDS_MS,
  REPLY_BUCKET_COUNT,
  SESSION_BUCKET_BOUNDS_MS,
  SESSION_BUCKET_COUNT,
  addToBuckets,
  emptyBuckets,
} from "./buckets";
import { PendingBuffer, pendingKey, type DailyDelta, type PeerDelta } from "./pending";

/**
 * Event → rollup-delta reducers. Aggregate on write, never on read (spec §1.3):
 * these run synchronously per captured event and only touch in-memory deltas;
 * the flush merges them into IndexedDB later.
 *
 * Deletes (and the revision side of edits) need the stored message row for
 * attribution, so they are queued here and resolved inside the flush
 * transaction instead.
 */

/** Flow-based reply latencies beyond this are conversation restarts, not replies. */
export const REPLY_FLOW_CAP_MS = 6 * 3_600_000;

/**
 * A usage session is a run of the user's OWN messages (any channel) with no
 * gap larger than this. Deliberately fixed rather than tied to the
 * conversation-gap setting: that setting defines per-channel initiations,
 * and changing it should not silently redefine what a "session" is.
 */
export const SESSION_GAP_MS = 30 * 60_000;

export interface ChannelHead {
  ts: number;
  authorId: string;
  /** messages in the current conversation (both sides); resets on initiation */
  burst?: number;
}

/** The still-open usage session — persisted in meta so restarts don't split it. */
export interface SessionState {
  startTs: number;
  lastTs: number;
}

export interface ReducerContext {
  ownUserId: string;
  settings(): { conversationGapMinutes: number };
  resolvePeerLabel(userId: string): { label: string | null; avatarHash: string | null } | null;
  /** other participants of a dm/group-dm channel, when resolvable */
  dmRecipients(channelId: string): string[] | null;
  /** channelId → last message seen (persisted across restarts via meta) */
  heads: Map<string, ChannelHead>;
  /** the open usage session, if any (persisted across restarts via meta) */
  session: SessionState | null;
  /** own words seen today, per channel — supports incremental uniqueWords */
  dayWords: Map<string, Set<string>>;
  currentDay: string | null;
}

export function createReducerContext(opts: {
  ownUserId: string;
  settings: ReducerContext["settings"];
  resolvePeerLabel: ReducerContext["resolvePeerLabel"];
  dmRecipients: ReducerContext["dmRecipients"];
  heads?: Map<string, ChannelHead>;
  session?: SessionState | null;
}): ReducerContext {
  return {
    ownUserId: opts.ownUserId,
    settings: opts.settings,
    resolvePeerLabel: opts.resolvePeerLabel,
    dmRecipients: opts.dmRecipients,
    heads: opts.heads ?? new Map(),
    session: opts.session ?? null,
    dayWords: new Map(),
    currentDay: null,
  };
}

function getDaily(pending: PendingBuffer, date: string, channelId: string, guildId: string | null): DailyDelta {
  const key = pendingKey(date, channelId);
  let delta = pending.daily.get(key);
  if (!delta) {
    delta = {
      guildId,
      sent: 0,
      edited: 0,
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
      longestBurst: 0,
      theirSent: 0,
      theirChars: 0,
      theirWords: 0,
      theirUniqueWords: 0,
      lengthBuckets: emptyBuckets(LENGTH_BUCKET_COUNT),
      theirLengthBuckets: emptyBuckets(LENGTH_BUCKET_COUNT),
    };
    pending.daily.set(key, delta);
  }
  return delta;
}

function getPeer(pending: PendingBuffer, ctx: ReducerContext, userId: string, ts: number): PeerDelta {
  let delta = pending.peers.get(userId);
  if (!delta) {
    const resolved = ctx.resolvePeerLabel(userId);
    delta = {
      label: resolved?.label ?? null,
      avatarHash: resolved?.avatarHash ?? null,
      msgToThem: 0,
      msgFromThem: 0,
      initiatedByMe: 0,
      initiatedByThem: 0,
      latencyMine: emptyBuckets(REPLY_BUCKET_COUNT),
      latencyTheirs: emptyBuckets(REPLY_BUCKET_COUNT),
      typingAbortedAtThem: 0,
      reactionsToThem: 0,
      reactionsFromThem: 0,
      firstTs: ts,
      lastTs: ts,
    };
    pending.peers.set(userId, delta);
  }
  delta.firstTs = Math.min(delta.firstTs, ts);
  delta.lastTs = Math.max(delta.lastTs, ts);
  return delta;
}

const tokenEdges = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function countNewWords(ctx: ReducerContext, date: string, channelId: string, content: string): number {
  if (ctx.currentDay !== date) {
    ctx.dayWords.clear();
    ctx.currentDay = date;
  }
  const key = pendingKey(date, channelId);
  let seen = ctx.dayWords.get(key);
  if (!seen) {
    seen = new Set();
    ctx.dayWords.set(key, seen);
  }
  let added = 0;
  for (const raw of content.toLowerCase().split(/\s+/)) {
    const word = raw.replace(tokenEdges, "");
    if (word.length === 0 || seen.has(word)) continue;
    seen.add(word);
    added++;
  }
  return added;
}

function isDmLike(kind: string): boolean {
  return kind === "dm" || kind === "group-dm";
}

function reduceMessageCreated(ev: MessageCreatedEvent, pending: PendingBuffer, ctx: ReducerContext): void {
  const date = dateKey(ev.ts);
  const dmLike = isDmLike(ev.channel.kind);
  const prev = ctx.heads.get(ev.channel.channelId);

  // conversation initiation — attributed to this message's author
  const gapMs = prev ? ev.ts - prev.ts : Infinity;
  const isInitiation = gapMs > ctx.settings().conversationGapMinutes * 60_000;
  const burst = isInitiation ? 1 : (prev?.burst ?? 0) + 1;
  {
    const daily = getDaily(pending, date, ev.channel.channelId, ev.channel.guildId);
    daily.longestBurst = Math.max(daily.longestBurst, burst);
  }
  if (isInitiation) {
    const daily = getDaily(pending, date, ev.channel.channelId, ev.channel.guildId);
    if (ev.isOwn) daily.initiatedByMe++;
    else daily.initiatedByThem++;
    if (dmLike) {
      if (ev.isOwn) {
        const recipients = ctx.dmRecipients(ev.channel.channelId);
        if (recipients?.length === 1) getPeer(pending, ctx, recipients[0]!, ev.ts).initiatedByMe++;
      } else {
        getPeer(pending, ctx, ev.authorId, ev.ts).initiatedByThem++;
      }
    }
  }

  // reply latency — explicit replies win; otherwise DM turn-taking flow
  let latencyRecorded = false;
  if (ev.replyToId && ev.replyToTs !== null && ev.replyToAuthorId) {
    const latency = Math.max(0, ev.ts - ev.replyToTs);
    if (ev.isOwn && ev.replyToAuthorId !== ctx.ownUserId) {
      const peer = getPeer(pending, ctx, ev.replyToAuthorId, ev.ts);
      peer.latencyMine = addToBuckets(peer.latencyMine, REPLY_BUCKET_COUNT, latency, REPLY_BUCKET_BOUNDS_MS);
      latencyRecorded = true;
    } else if (!ev.isOwn && ev.replyToAuthorId === ctx.ownUserId) {
      const peer = getPeer(pending, ctx, ev.authorId, ev.ts);
      peer.latencyTheirs = addToBuckets(peer.latencyTheirs, REPLY_BUCKET_COUNT, latency, REPLY_BUCKET_BOUNDS_MS);
      latencyRecorded = true;
    }
  }
  if (!latencyRecorded && dmLike && prev && prev.authorId !== ev.authorId && gapMs <= REPLY_FLOW_CAP_MS) {
    if (ev.isOwn && prev.authorId !== ctx.ownUserId) {
      const peer = getPeer(pending, ctx, prev.authorId, ev.ts);
      peer.latencyMine = addToBuckets(peer.latencyMine, REPLY_BUCKET_COUNT, gapMs, REPLY_BUCKET_BOUNDS_MS);
    } else if (!ev.isOwn && prev.authorId === ctx.ownUserId) {
      const peer = getPeer(pending, ctx, ev.authorId, ev.ts);
      peer.latencyTheirs = addToBuckets(peer.latencyTheirs, REPLY_BUCKET_COUNT, gapMs, REPLY_BUCKET_BOUNDS_MS);
    }
  }

  // peer message counters — 1:1 DMs for msgToThem; any dm-like author for msgFromThem
  if (dmLike) {
    if (ev.isOwn) {
      const recipients = ctx.dmRecipients(ev.channel.channelId);
      if (ev.channel.kind === "dm" && recipients?.length === 1) {
        getPeer(pending, ctx, recipients[0]!, ev.ts).msgToThem++;
      }
    } else {
      getPeer(pending, ctx, ev.authorId, ev.ts).msgFromThem++;
    }
  }

  // theirs-side text stats — DM/group-DM only, the content rule's storable side
  if (!ev.isOwn && dmLike) {
    const daily = getDaily(pending, date, ev.channel.channelId, ev.channel.guildId);
    daily.theirSent++;
    daily.theirChars += ev.chars;
    daily.theirWords += ev.words;
    daily.theirLengthBuckets = addToBuckets(daily.theirLengthBuckets, LENGTH_BUCKET_COUNT, ev.chars, LENGTH_BUCKET_BOUNDS_CHARS);
    if (ev.content !== null) {
      daily.theirUniqueWords += countNewWords(ctx, date, `theirs:${ev.channel.channelId}`, ev.content);
      collectText(ev.content, "theirs", ev, pending);
    }
  }

  // own-activity rollups
  if (ev.isOwn) {
    trackSession(ev.ts, pending, ctx);
    const daily = getDaily(pending, date, ev.channel.channelId, ev.channel.guildId);
    daily.sent++;
    daily.chars += ev.chars;
    daily.words += ev.words;
    daily.lengthBuckets = addToBuckets(daily.lengthBuckets, LENGTH_BUCKET_COUNT, ev.chars, LENGTH_BUCKET_BOUNDS_CHARS);
    if (ev.content !== null) {
      daily.uniqueWords += countNewWords(ctx, date, ev.channel.channelId, ev.content);
      collectText(ev.content, "mine", ev, pending);
    }
    for (const flag of Object.keys(daily.contentTypes) as Array<keyof typeof daily.contentTypes>) {
      if (ev.contentTypes[flag]) daily.contentTypes[flag]++;
    }
    const hourKey = pendingKey(date, hourOf(ev.ts));
    pending.hourly.set(hourKey, (pending.hourly.get(hourKey) ?? 0) + 1);

    const scope = ev.channel.guildId ?? "dm";
    for (const emoji of ev.customEmoji) {
      const key = pendingKey(scope, emoji.id);
      const entry = pending.emoji.get(key) ?? { name: emoji.name, count: 0 };
      entry.count++;
      entry.name = emoji.name;
      pending.emoji.set(key, entry);
    }
  }

  for (const domain of ev.domains) {
    const entry = pending.domains.get(domain) ?? { count: 0, lastTs: ev.ts };
    entry.count++;
    entry.lastTs = Math.max(entry.lastTs, ev.ts);
    pending.domains.set(domain, entry);
  }

  // message row (content already scoped by normalize)
  if (!pending.messageCreates.has(ev.messageId)) {
    pending.messageCreates.set(ev.messageId, {
      messageId: ev.messageId,
      ts: ev.ts,
      channelId: ev.channel.channelId,
      guildId: ev.channel.guildId,
      authorId: ev.authorId,
      isOwn: ev.isOwn,
      content: ev.content,
      revisions: [],
      deletedAt: null,
      deleteAfterMs: null,
      editCount: 0,
      lastEditedTs: null,
      replyToId: ev.replyToId,
      contentTypes: ev.contentTypes,
      chars: ev.chars,
      words: ev.words,
    });
  }

  ctx.heads.set(ev.channel.channelId, { ts: ev.ts, authorId: ev.authorId, burst });
}

/** Words/phrases rollup + inverted-index postings — only ever fed storable content. */
function collectText(content: string, scope: "mine" | "theirs", ev: MessageCreatedEvent, pending: PendingBuffer): void {
  const tokens = tokenize(content);
  for (const token of tokens) {
    const key = `${scope} ${token}`;
    pending.words.set(key, (pending.words.get(key) ?? 0) + 1);
  }
  for (const phrase of bigrams(tokens)) {
    const key = `${scope} ${phrase}`;
    pending.words.set(key, (pending.words.get(key) ?? 0) + 1);
  }
  for (const term of new Set(tokens)) {
    pending.searchIndex.push({
      term,
      messageId: ev.messageId,
      ts: ev.ts,
      channelId: ev.channel.channelId,
      guildId: ev.channel.guildId,
      isOwn: ev.isOwn,
    });
  }
}

function trackSession(ts: number, pending: PendingBuffer, ctx: ReducerContext): void {
  const open = ctx.session;
  if (open && ts - open.lastTs <= SESSION_GAP_MS) {
    open.lastTs = Math.max(open.lastTs, ts);
    return;
  }
  if (open) {
    const date = dateKey(open.startTs);
    const delta = pending.sessions.get(date) ?? { buckets: emptyBuckets(SESSION_BUCKET_COUNT), totalMs: 0 };
    const durationMs = Math.max(0, open.lastTs - open.startTs);
    delta.buckets = addToBuckets(delta.buckets, SESSION_BUCKET_COUNT, durationMs, SESSION_BUCKET_BOUNDS_MS);
    delta.totalMs += durationMs;
    pending.sessions.set(date, delta);
  }
  ctx.session = { startTs: ts, lastTs: ts };
}

function reduceTyping(ev: TypingResolvedEvent, pending: PendingBuffer, ctx: ReducerContext): void {
  const daily = getDaily(pending, dateKey(ev.ts), ev.channel.channelId, ev.channel.guildId);
  if (ev.committed) daily.typingCommitted++;
  else daily.typingAborted++;
  daily.typingMs += ev.durationMs;
  if (!ev.committed && ev.peerId) getPeer(pending, ctx, ev.peerId, ev.ts).typingAbortedAtThem++;
}

function reduceReaction(ev: ReactionEvent, pending: PendingBuffer, ctx: ReducerContext): void {
  const date = dateKey(ev.ts);
  if (ev.actorIsOwn) {
    getDaily(pending, date, ev.channel.channelId, ev.channel.guildId).reactionsGiven += ev.direction;
    if (ev.messageAuthorId && !ev.messageAuthorIsOwn) {
      getPeer(pending, ctx, ev.messageAuthorId, ev.ts).reactionsToThem += ev.direction;
    }
    if (ev.emoji.id) {
      const key = pendingKey(ev.channel.guildId ?? "dm", ev.emoji.id);
      const entry = pending.emoji.get(key) ?? { name: ev.emoji.name, count: 0 };
      entry.count += ev.direction;
      entry.name = ev.emoji.name;
      pending.emoji.set(key, entry);
    }
  } else if (ev.messageAuthorIsOwn) {
    getDaily(pending, date, ev.channel.channelId, ev.channel.guildId).reactionsReceived += ev.direction;
    getPeer(pending, ctx, ev.actorId, ev.ts).reactionsFromThem += ev.direction;
  }
}

export function reduceEvent(ev: CapturedEvent, pending: PendingBuffer, ctx: ReducerContext): void {
  pending.events.push(ev);

  switch (ev.kind) {
    case "message-created":
      reduceMessageCreated(ev, pending, ctx);
      break;
    case "message-edited":
      if (ev.isOwn) getDaily(pending, dateKey(ev.ts), ev.channel.channelId, ev.channel.guildId).edited++;
      pending.messageEdits.push(ev);
      break;
    case "message-deleted":
      // attribution needs the stored row — resolved inside the flush transaction
      pending.messageDeletes.push(ev);
      break;
    case "typing-resolved":
      reduceTyping(ev, pending, ctx);
      break;
    case "reaction":
      reduceReaction(ev, pending, ctx);
      break;
    case "dwell":
      getDaily(pending, dateKey(ev.ts), ev.channel.channelId, ev.channel.guildId).dwellMs += ev.durationMs;
      break;
    case "voice-segment": {
      const key = pendingKey(dateKey(ev.ts), ev.channel.channelId);
      const entry = pending.voice.get(key) ?? { guildId: ev.channel.guildId, seconds: 0, coPresent: {} };
      entry.seconds += ev.seconds;
      for (const [userId, seconds] of Object.entries(ev.coPresent)) {
        entry.coPresent[userId] = (entry.coPresent[userId] ?? 0) + seconds;
      }
      pending.voice.set(key, entry);
      break;
    }
  }
}
