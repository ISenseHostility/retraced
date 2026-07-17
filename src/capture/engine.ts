import { PendingBuffer } from "../aggregate/pending";
import { createReducerContext, reduceEvent, type ChannelHead, type ReducerContext, type SessionState } from "../aggregate/reducers";
import { flushPending } from "../db/flush";
import { pruneEvents, pruneMessages } from "../db/prune";
import { wipeContentOnly } from "../db/wipe";
import { ALL_STORES, openRetracedDb, type RetracedDatabase } from "../db/schema";
import { warn } from "../env/bd";
import { Disposer } from "../lifecycle/disposer";
import type { RetracedSettings } from "../settings";
import { DwellTracker } from "./dwell";
import { TypingTracker } from "./hesitation";
import {
  normalizeMessageCreate,
  normalizeMessageDelete,
  normalizeMessageUpdate,
  normalizeReaction,
  type NormalizeCtx,
} from "./normalize";
import type { CapturedEvent, ChannelRef } from "./types";
import { VoiceTracker } from "./voice";

/**
 * The capture orchestrator: Discord hooks → normalize → trackers → reducers →
 * debounced single-transaction flush. All Discord specifics come in through
 * CaptureHooks (fail-soft, injected), so this whole pipeline is testable
 * without Discord.
 */

export interface CaptureHooks {
  /** returns an unsubscribe, or null when the dispatcher is unavailable */
  subscribeDispatch(type: string, handler: (action: any) => void): (() => void) | null;
  /** patches Discord's startTyping/stopTyping; returns unpatch or null */
  patchTyping(onStart: (channelId: string) => void, onStop: (channelId: string) => void): (() => void) | null;
  getOwnUserId(): string | null;
  resolveChannel(channelId: string): ChannelRef;
  resolveDmRecipients(channelId: string): string[] | null;
  resolveUser(userId: string): { label: string | null; avatarHash: string | null } | null;
  getVoiceChannelMembers(channelId: string): string[] | null;
}

export type EngineStatus = "idle" | "starting" | "running" | "degraded" | "unavailable" | "stopped";

export interface SessionCounters {
  byKind: Record<string, number>;
  total: number;
  buffered: number;
  flushedEvents: number;
  flushes: number;
  dropped: number;
  openTypingSessions: number;
  lastFlushTs: number | null;
}

export interface EngineSnapshot {
  status: EngineStatus;
  statusDetail: string | null;
  session: SessionCounters;
}

export interface CaptureEngineOptions {
  hooks: CaptureHooks;
  settings(): RetracedSettings;
  now?(): number;
  flushDebounceMs?: number;
  sweepIntervalMs?: number;
  pruneIntervalMs?: number;
}

const EDIT_LRU_MAX = 2048;

const freshCounters = (): SessionCounters => ({
  byKind: {},
  total: 0,
  buffered: 0,
  flushedEvents: 0,
  flushes: 0,
  dropped: 0,
  openTypingSessions: 0,
  lastFlushTs: null,
});

export class CaptureEngine {
  private readonly hooks: CaptureHooks;
  private readonly settings: () => RetracedSettings;
  private readonly now: () => number;
  private readonly flushDebounceMs: number;
  private readonly sweepIntervalMs: number;
  private readonly pruneIntervalMs: number;

  private db: RetracedDatabase | null = null;
  private disposer: Disposer | null = null;
  private status: EngineStatus = "idle";
  private statusDetail: string | null = null;

  private userId: string | null = null;
  private reducerCtx: ReducerContext | null = null;
  private normCtx: NormalizeCtx | null = null;
  private typing: TypingTracker | null = null;
  private dwell: DwellTracker | null = null;
  private voice: VoiceTracker | null = null;
  private hydratedHeads = new Map<string, ChannelHead>();
  private hydratedSession: SessionState | null = null;

  private pending = new PendingBuffer();
  private counters = freshCounters();
  private editLru = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** flushes are serialized on this chain; flushNow() always awaits completion */
  private flushChain: Promise<void> = Promise.resolve();
  private stopping = false;

  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot;

  constructor(opts: CaptureEngineOptions) {
    this.hooks = opts.hooks;
    this.settings = opts.settings;
    this.now = opts.now ?? (() => Date.now());
    this.flushDebounceMs = opts.flushDebounceMs ?? 5_000;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 3_000;
    this.pruneIntervalMs = opts.pruneIntervalMs ?? 6 * 3_600_000;
    this.snapshot = { status: this.status, statusDetail: null, session: this.counters };
  }

  async start(): Promise<void> {
    if (this.disposer) return;
    const d = (this.disposer = new Disposer());
    this.setStatus("starting", null);

    if (typeof indexedDB === "undefined") {
      this.setStatus("unavailable", "IndexedDB is not available — capture disabled");
      return;
    }
    try {
      this.db = await openRetracedDb();
    } catch (e) {
      warn("could not open the retraced database — capture disabled", e);
      this.setStatus("unavailable", "database unavailable — capture disabled");
      return;
    }
    d.add(() => {
      this.db?.close();
      this.db = null;
    });

    // keep the origin out of storage-pressure eviction (spec §6)
    try {
      void (navigator as any)?.storage?.persist?.();
    } catch {
      /* optional API */
    }

    await this.prune();
    await this.hydrateHeads();

    this.userId = this.hooks.getOwnUserId();
    if (this.userId) this.beginCapture(this.userId);

    const missing: string[] = [];
    const sub = (type: string, handler: (action: any) => void): void => {
      const unsubscribe = this.hooks.subscribeDispatch(type, handler);
      if (unsubscribe) d.add(unsubscribe);
      else missing.push(type);
    };

    sub("MESSAGE_CREATE", (a) => this.onMessageCreate(a));
    sub("MESSAGE_UPDATE", (a) => this.onMessageUpdate(a));
    sub("MESSAGE_DELETE", (a) => this.onMessageDelete(a));
    sub("MESSAGE_REACTION_ADD", (a) => this.onReaction(a, 1));
    sub("MESSAGE_REACTION_REMOVE", (a) => this.onReaction(a, -1));
    sub("CHANNEL_SELECT", (a) => this.dwell?.channelSelected(a?.channelId ?? a?.channel_id ?? null));
    sub("TYPING_START", (a) => {
      // self-typing echoes (e.g. from another device); local typing comes via the patch
      if (this.userId && String(a?.userId ?? a?.user_id ?? "") === this.userId) {
        this.typing?.ping(String(a?.channelId ?? a?.channel_id ?? ""));
      }
    });
    sub("VOICE_STATE_UPDATES", (a) => this.onVoiceStates(a?.voiceStates ?? []));
    sub("VOICE_STATE_UPDATE", (a) => this.onVoiceStates([a?.voiceState ?? a]));
    sub("CONNECTION_OPEN", () => void this.ensureUser());

    const unpatch = this.hooks.patchTyping(
      (channelId) => this.typing?.ping(channelId),
      (channelId) => this.typing?.stopped(channelId)
    );
    if (unpatch) d.add(unpatch);
    else missing.push("typing patch");

    const sweep = setInterval(() => {
      this.typing?.sweep();
      this.bumpTypingGauge();
    }, this.sweepIntervalMs);
    d.add(() => clearInterval(sweep));

    const prune = setInterval(() => void this.prune(), this.pruneIntervalMs);
    d.add(() => clearInterval(prune));

    if (typeof window !== "undefined") {
      const onFocus = (): void => this.dwell?.focusChanged(true);
      const onBlur = (): void => this.dwell?.focusChanged(false);
      const onUnload = (): void => void this.flushNow();
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
      window.addEventListener("beforeunload", onUnload);
      d.add(() => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("beforeunload", onUnload);
      });
    }

    if (missing.length >= 9) {
      this.setStatus("degraded", "Discord dispatcher not found — capture disabled until a plugin update");
    } else if (!this.userId) {
      this.setStatus("degraded", "current user not resolved yet — capture paused");
    } else {
      this.setStatus("running", missing.length > 0 ? `unavailable hooks: ${missing.join(", ")}` : null);
    }
  }

  async stop(): Promise<void> {
    if (!this.disposer) return;
    this.stopping = true;

    this.typing?.dispose(); // open sessions are discarded, never guessed
    this.dwell?.closeAll();
    this.voice?.closeAll();

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushNow();

    this.disposer.dispose();
    this.disposer = null;
    this.typing = null;
    this.dwell = null;
    this.voice = null;
    this.reducerCtx = null;
    this.normCtx = null;
    this.userId = null;
    this.counters = freshCounters();
    this.stopping = false;
    this.setStatus("stopped", null);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  async getRowCounts(): Promise<Record<string, number> | null> {
    if (!this.db) return null;
    const counts: Record<string, number> = {};
    for (const store of ALL_STORES) counts[store] = await this.db.count(store);
    return counts;
  }

  async getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const estimate = await (navigator as any)?.storage?.estimate?.();
      return estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null;
    } catch {
      return null;
    }
  }

  /** exposed for the dev tools (synthetic data) and Data-tab work in later phases */
  getDb(): RetracedDatabase | null {
    return this.db;
  }

  /** read-only settings view for the UI (e.g. the stopword filter) */
  getSettings(): RetracedSettings {
    return this.settings();
  }

  /**
   * The kill-switch contract (spec §1.2): stop capturing text AND purge what
   * is already stored, without touching the rollups. Flushes first so no
   * buffered content survives in the pending batch.
   */
  async purgeContent(): Promise<void> {
    if (!this.db) return;
    await this.flushNow();
    await wipeContentOnly(this.db);
    this.notify();
  }

  flushNow(): Promise<void> {
    const run = this.flushChain.then(() => this.doFlush());
    this.flushChain = run.catch(() => undefined);
    return run;
  }

  private async doFlush(): Promise<void> {
    if (!this.db || this.pending.isEmpty) return;
    const batch = this.pending;
    this.pending = new PendingBuffer();
    try {
      const result = await flushPending(this.db, batch, {
        now: this.now(),
        heads: this.reducerCtx?.heads ?? new Map(),
        session: this.reducerCtx ? this.reducerCtx.session : undefined,
      });
      this.counters.flushedEvents += result.events;
      this.counters.flushes += 1;
      this.counters.lastFlushTs = this.now();
      this.counters.buffered = this.pending.events.length;
    } catch (e) {
      warn("flush failed — this batch is lost (rollups remain consistent)", e);
    } finally {
      this.notify();
    }
  }

  private beginCapture(userId: string): void {
    if (this.reducerCtx) {
      this.reducerCtx.ownUserId = userId;
      return;
    }
    this.reducerCtx = createReducerContext({
      ownUserId: userId,
      settings: () => ({ conversationGapMinutes: this.settings().conversationGapMinutes }),
      resolvePeerLabel: (id) => this.hooks.resolveUser(id),
      dmRecipients: (id) => this.hooks.resolveDmRecipients(id),
      heads: this.hydratedHeads,
      session: this.hydratedSession,
    });
    this.normCtx = {
      ownUserId: userId,
      resolveChannel: (id) => this.hooks.resolveChannel(id),
      now: this.now,
      contentStorageEnabled: () => this.settings().contentStorageEnabled,
    };
    this.typing = new TypingTracker({
      now: this.now,
      resolve: (r) =>
        this.ingest({
          kind: "typing-resolved",
          ts: r.resolvedAt,
          channel: r.channel,
          startedAt: r.startedAt,
          durationMs: r.durationMs,
          committed: r.committed,
          peerId: r.peerId,
        }),
      resolveChannel: (id) => this.hooks.resolveChannel(id),
      resolveDmPeer: (id) => {
        const recipients = this.hooks.resolveDmRecipients(id);
        return recipients?.length === 1 ? recipients[0]! : null;
      },
    });
    this.dwell = new DwellTracker({
      now: this.now,
      emit: (e) => this.ingest(e),
      resolveChannel: (id) => this.hooks.resolveChannel(id),
      isFocused: () => (typeof document !== "undefined" ? document.hasFocus() : true),
    });
    this.voice = new VoiceTracker({
      now: this.now,
      emit: (e) => this.ingest(e),
      resolveChannel: (id) => this.hooks.resolveChannel(id),
      ownUserId: userId,
      getChannelMembers: (id) => this.hooks.getVoiceChannelMembers(id),
    });
  }

  private ensureUser(): boolean {
    if (this.userId) return true;
    this.userId = this.hooks.getOwnUserId();
    if (this.userId) {
      this.beginCapture(this.userId);
      if (this.status === "degraded") this.setStatus("running", null);
      return true;
    }
    this.counters.dropped += 1;
    this.notify();
    return false;
  }

  private ingest(ev: CapturedEvent): void {
    if (!this.reducerCtx) return;
    reduceEvent(ev, this.pending, this.reducerCtx);
    this.counters.byKind[ev.kind] = (this.counters.byKind[ev.kind] ?? 0) + 1;
    this.counters.total += 1;
    this.counters.buffered = this.pending.events.length;
    this.scheduleFlush();
    this.notify();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.stopping || !this.db) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, this.flushDebounceMs);
  }

  private onMessageCreate(action: any): void {
    if (!this.ensureUser() || !this.normCtx) return;
    const ev = normalizeMessageCreate(action, this.normCtx);
    if (!ev) return;
    if (ev.isOwn) this.typing?.messageSent(ev.channel.channelId);
    this.ingest(ev);
    this.bumpTypingGauge();
  }

  private onMessageUpdate(action: any): void {
    if (!this.ensureUser() || !this.normCtx) return;
    const ev = normalizeMessageUpdate(action, this.normCtx);
    if (!ev || this.seenEdit(ev.messageId, ev.ts)) return;
    this.ingest(ev);
  }

  private onMessageDelete(action: any): void {
    if (!this.ensureUser() || !this.normCtx) return;
    const ev = normalizeMessageDelete(action, this.normCtx);
    if (ev) this.ingest(ev);
  }

  private onReaction(action: any, direction: 1 | -1): void {
    if (!this.ensureUser() || !this.normCtx) return;
    const ev = normalizeReaction(action, direction, this.normCtx);
    if (ev) this.ingest(ev);
  }

  private onVoiceStates(states: any[]): void {
    if (!this.ensureUser() || !this.voice) return;
    this.voice.handleVoiceStates(
      (Array.isArray(states) ? states : []).map((s) => ({
        userId: String(s?.userId ?? s?.user_id ?? ""),
        channelId: s?.channelId ?? s?.channel_id ?? null,
      }))
    );
  }

  private seenEdit(messageId: string, editedTs: number): boolean {
    if (this.editLru.get(messageId) === editedTs) return true;
    this.editLru.delete(messageId);
    this.editLru.set(messageId, editedTs);
    if (this.editLru.size > EDIT_LRU_MAX) {
      this.editLru.delete(this.editLru.keys().next().value!);
    }
    return false;
  }

  private async prune(): Promise<void> {
    if (!this.db) return;
    try {
      const settings = this.settings();
      await pruneEvents(this.db, this.now() - settings.eventRetentionDays * 86_400_000);
      if (settings.messagesRetentionDays > 0) {
        await pruneMessages(this.db, this.now() - settings.messagesRetentionDays * 86_400_000);
      }
    } catch (e) {
      warn("prune failed", e);
    }
  }

  private async hydrateHeads(): Promise<void> {
    try {
      const stored = (await this.db?.get("meta", "channelHeads")) as Array<[string, ChannelHead]> | undefined;
      if (Array.isArray(stored)) this.hydratedHeads = new Map(stored);
      const session = (await this.db?.get("meta", "sessionState")) as SessionState | null | undefined;
      if (session && typeof session.startTs === "number" && typeof session.lastTs === "number") {
        this.hydratedSession = session;
      }
    } catch (e) {
      warn("could not hydrate channel heads — initiation attribution starts fresh", e);
    }
  }

  private bumpTypingGauge(): void {
    const open = this.typing?.openSessionCount ?? 0;
    if (open !== this.counters.openTypingSessions) {
      this.counters.openTypingSessions = open;
      this.notify();
    }
  }

  private setStatus(status: EngineStatus, detail: string | null): void {
    this.status = status;
    this.statusDetail = detail;
    this.notify();
  }

  private notify(): void {
    this.snapshot = {
      status: this.status,
      statusDetail: this.statusDetail,
      session: { ...this.counters, byKind: { ...this.counters.byKind } },
    };
    for (const listener of [...this.listeners]) listener();
  }
}
