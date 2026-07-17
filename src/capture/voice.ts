import type { ChannelRef, VoiceSegmentEvent } from "./types";

/**
 * Voice presence tracker (spec §3). A segment spans own join → own leave/move;
 * co-presence seconds accrue per other user actually sharing the channel.
 * Membership is seeded from the voice-state store on join (when available) and
 * maintained from voice-state deltas afterwards. Voice is NOT focus-gated —
 * being in a call counts whether or not the window is focused.
 */

const MIN_SEGMENT_MS = 1_000;

export interface VoiceStateLike {
  userId: string;
  channelId: string | null;
}

interface Session {
  channelId: string;
  startTs: number;
  /** userId -> since-ts for users currently sharing the channel */
  present: Map<string, number>;
  /** userId -> accumulated ms for users who already left */
  accumulatedMs: Map<string, number>;
}

export interface VoiceTrackerOptions {
  now(): number;
  emit(event: VoiceSegmentEvent): void;
  resolveChannel(channelId: string): ChannelRef;
  ownUserId: string;
  /** current member ids of a voice channel, when the store is available */
  getChannelMembers(channelId: string): string[] | null;
}

export class VoiceTracker {
  private session: Session | null = null;

  constructor(private readonly opts: VoiceTrackerOptions) {}

  handleVoiceStates(states: VoiceStateLike[]): void {
    const now = this.opts.now();
    for (const state of states) {
      if (!state?.userId) continue;
      if (state.userId === this.opts.ownUserId) this.handleOwnState(state, now);
      else this.handleOtherState(state, now);
    }
  }

  closeAll(): void {
    this.closeSession(this.opts.now());
  }

  private handleOwnState(state: VoiceStateLike, now: number): void {
    const currentChannel = this.session?.channelId ?? null;
    if (state.channelId === currentChannel) return;

    this.closeSession(now);
    if (!state.channelId) return;

    const present = new Map<string, number>();
    for (const member of this.opts.getChannelMembers(state.channelId) ?? []) {
      if (member !== this.opts.ownUserId) present.set(member, now);
    }
    this.session = { channelId: state.channelId, startTs: now, present, accumulatedMs: new Map() };
  }

  private handleOtherState(state: VoiceStateLike, now: number): void {
    const session = this.session;
    if (!session) return;
    const inMyChannel = state.channelId === session.channelId;
    const tracked = session.present.has(state.userId);
    if (inMyChannel && !tracked) {
      session.present.set(state.userId, now);
    } else if (!inMyChannel && tracked) {
      const since = session.present.get(state.userId)!;
      session.present.delete(state.userId);
      session.accumulatedMs.set(state.userId, (session.accumulatedMs.get(state.userId) ?? 0) + (now - since));
    }
  }

  private closeSession(now: number): void {
    const session = this.session;
    this.session = null;
    if (!session) return;
    const totalMs = now - session.startTs;
    if (totalMs < MIN_SEGMENT_MS) return;

    const coPresent: Record<string, number> = {};
    for (const [userId, ms] of session.accumulatedMs) {
      coPresent[userId] = (coPresent[userId] ?? 0) + ms;
    }
    for (const [userId, since] of session.present) {
      coPresent[userId] = (coPresent[userId] ?? 0) + (now - since);
    }
    for (const userId of Object.keys(coPresent)) {
      coPresent[userId] = Math.round(coPresent[userId]! / 1000);
      if (coPresent[userId] === 0) delete coPresent[userId];
    }

    this.opts.emit({
      kind: "voice-segment",
      ts: session.startTs,
      channel: this.opts.resolveChannel(session.channelId),
      seconds: Math.round(totalMs / 1000),
      coPresent,
    });
  }
}
