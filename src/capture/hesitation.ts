import type { ChannelRef } from "./types";

/**
 * The hesitation state machine (spec §3, flagship metric).
 *
 * Inputs are the user's own typing signals:
 *  - ping(channel)     — Discord's startTyping fires on the first keystroke and
 *                        re-fires every ~8–10s while typing continues
 *  - stopped(channel)  — Discord's stopTyping (input cleared: sent OR erased)
 *  - messageSent(chan) — the user's own MESSAGE_CREATE landed in that channel
 *
 * Resolution rules:
 *  - own message while a session is open        → COMMITTED, duration = msg − start
 *  - no ping refresh for > lapseMs (12s)        → ABORTED, duration = lastSeen − start
 *  - explicit stop with no message for graceMs  → ABORTED, duration = stop − start
 *    (grace exists because the send flow emits stopTyping just before the
 *     gateway echoes the message back; a slow echo must not read as an abort)
 *
 * Channel switches mid-type stop the pings, so the lapse rule resolves them.
 * Edits never reach this machine: Discord's edit box does not call startTyping.
 * A session aborted by sweep just before a late echo arrives stays aborted —
 * rare and acceptable. dispose() discards open sessions unresolved.
 */

export interface TypingResolution {
  channel: ChannelRef;
  startedAt: number;
  durationMs: number;
  committed: boolean;
  /** the 1:1 DM partner, when the channel is a DM */
  peerId: string | null;
  resolvedAt: number;
}

interface Session {
  startedAt: number;
  lastSeen: number;
  stoppedAt: number | null;
}

export interface TypingTrackerOptions {
  now(): number;
  resolve(resolution: TypingResolution): void;
  resolveChannel(channelId: string): ChannelRef;
  resolveDmPeer(channelId: string): string | null;
  /** ms without a ping refresh before a session lapses (default 12s) */
  lapseMs?: number;
  /** ms after an explicit stop before the session aborts (default 5s) */
  stopGraceMs?: number;
}

export const DEFAULT_LAPSE_MS = 12_000;
export const DEFAULT_STOP_GRACE_MS = 5_000;

export class TypingTracker {
  private sessions = new Map<string, Session>();
  private readonly lapseMs: number;
  private readonly stopGraceMs: number;

  constructor(private readonly opts: TypingTrackerOptions) {
    this.lapseMs = opts.lapseMs ?? DEFAULT_LAPSE_MS;
    this.stopGraceMs = opts.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  }

  get openSessionCount(): number {
    return this.sessions.size;
  }

  ping(channelId: string): void {
    const now = this.opts.now();
    const session = this.sessions.get(channelId);
    if (session) {
      session.lastSeen = now;
      session.stoppedAt = null; // typing resumed — cancel any pending abort
    } else {
      this.sessions.set(channelId, { startedAt: now, lastSeen: now, stoppedAt: null });
    }
  }

  stopped(channelId: string): void {
    const session = this.sessions.get(channelId);
    if (session) session.stoppedAt = this.opts.now();
  }

  messageSent(channelId: string): void {
    const session = this.sessions.get(channelId);
    if (!session) return;
    this.sessions.delete(channelId);
    const now = this.opts.now();
    this.emit(channelId, session, now - session.startedAt, true, now);
  }

  /** Called on a coarse interval (~3s). Resolves lapsed and stop-expired sessions. */
  sweep(): void {
    const now = this.opts.now();
    for (const [channelId, session] of [...this.sessions]) {
      if (session.stoppedAt !== null && now - session.stoppedAt >= this.stopGraceMs) {
        this.sessions.delete(channelId);
        this.emit(channelId, session, Math.max(0, session.stoppedAt - session.startedAt), false, now);
      } else if (now - session.lastSeen >= this.lapseMs) {
        this.sessions.delete(channelId);
        this.emit(channelId, session, Math.max(0, session.lastSeen - session.startedAt), false, now);
      }
    }
  }

  dispose(): void {
    this.sessions.clear();
  }

  private emit(channelId: string, session: Session, durationMs: number, committed: boolean, resolvedAt: number): void {
    const channel = this.opts.resolveChannel(channelId);
    this.opts.resolve({
      channel,
      startedAt: session.startedAt,
      durationMs,
      committed,
      peerId: channel.kind === "dm" ? this.opts.resolveDmPeer(channelId) : null,
      resolvedAt,
    });
  }
}
