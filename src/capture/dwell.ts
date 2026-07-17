import type { ChannelRef, DwellEvent } from "./types";

/**
 * Channel dwell tracker (spec §3, lurk ratio). Counts time between selecting a
 * channel and selecting the next one — but only while the window is focused,
 * so an idle background client never records hours of "reading".
 */

const MIN_DWELL_MS = 1_000;

interface Segment {
  channelId: string;
  startTs: number;
  accumulatedMs: number;
  focusedSince: number | null;
}

export interface DwellTrackerOptions {
  now(): number;
  emit(event: DwellEvent): void;
  resolveChannel(channelId: string): ChannelRef;
  isFocused(): boolean;
}

export class DwellTracker {
  private current: Segment | null = null;

  constructor(private readonly opts: DwellTrackerOptions) {}

  channelSelected(channelId: string | null): void {
    const now = this.opts.now();
    this.finalize(now);
    if (channelId) {
      this.current = {
        channelId,
        startTs: now,
        accumulatedMs: 0,
        focusedSince: this.opts.isFocused() ? now : null,
      };
    }
  }

  focusChanged(focused: boolean): void {
    const now = this.opts.now();
    const segment = this.current;
    if (!segment) return;
    if (focused && segment.focusedSince === null) {
      segment.focusedSince = now;
    } else if (!focused && segment.focusedSince !== null) {
      segment.accumulatedMs += now - segment.focusedSince;
      segment.focusedSince = null;
    }
  }

  closeAll(): void {
    this.finalize(this.opts.now());
  }

  private finalize(now: number): void {
    const segment = this.current;
    this.current = null;
    if (!segment) return;
    const total = segment.accumulatedMs + (segment.focusedSince !== null ? now - segment.focusedSince : 0);
    if (total < MIN_DWELL_MS) return;
    this.opts.emit({
      kind: "dwell",
      ts: segment.startTs,
      channel: this.opts.resolveChannel(segment.channelId),
      durationMs: total,
    });
  }
}
