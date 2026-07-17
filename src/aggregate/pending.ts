import type { CapturedEvent, ContentTypeFlags, MessageDeletedEvent, MessageEditedEvent } from "../capture/types";
import type { MessageRow, SearchPosting } from "../db/schema";

/** Composite in-memory map key. Ids and dates never contain spaces. */
export const pendingKey = (a: string | number, b: string | number): string => `${a} ${b}`;

export interface DailyDelta {
  guildId: string | null;
  sent: number;
  edited: number;
  chars: number;
  words: number;
  uniqueWords: number;
  typingCommitted: number;
  typingAborted: number;
  typingMs: number;
  dwellMs: number;
  reactionsGiven: number;
  reactionsReceived: number;
  contentTypes: Record<keyof ContentTypeFlags, number>;
  initiatedByMe: number;
  initiatedByThem: number;
  /** merged as a MAX at flush, unlike the additive fields */
  longestBurst: number;
  theirSent: number;
  theirChars: number;
  theirWords: number;
  theirUniqueWords: number;
  lengthBuckets: number[];
  theirLengthBuckets: number[];
}

export interface PeerDelta {
  label: string | null;
  avatarHash: string | null;
  msgToThem: number;
  msgFromThem: number;
  initiatedByMe: number;
  initiatedByThem: number;
  latencyMine: number[];
  latencyTheirs: number[];
  typingAbortedAtThem: number;
  reactionsToThem: number;
  reactionsFromThem: number;
  firstTs: number;
  lastTs: number;
}

export interface VoiceDelta {
  guildId: string | null;
  seconds: number;
  coPresent: Record<string, number>;
}

export interface SessionDelta {
  buckets: number[];
  totalMs: number;
}

/**
 * Everything captured since the last flush, pre-reduced into rollup deltas.
 * Purely in-memory; a flush swaps the whole buffer out and merges it into
 * IndexedDB in a single transaction.
 */
export class PendingBuffer {
  events: CapturedEvent[] = [];
  messageCreates = new Map<string, MessageRow>();
  messageEdits: MessageEditedEvent[] = [];
  messageDeletes: MessageDeletedEvent[] = [];
  /** key: `${date} ${channelId}` */
  daily = new Map<string, DailyDelta>();
  /** key: `${date} ${hour}` → own messages sent */
  hourly = new Map<string, number>();
  peers = new Map<string, PeerDelta>();
  /** key: `${date} ${channelId}` */
  voice = new Map<string, VoiceDelta>();
  /** key: date the session started — resolved usage sessions, as a duration histogram */
  sessions = new Map<string, SessionDelta>();
  /** key: `${scope} ${term}` (term itself may contain a space — bigram "phrases") */
  words = new Map<string, number>();
  /** inverted-index postings for content-storable messages in this batch */
  searchIndex: SearchPosting[] = [];
  /** key: `${guildScope} ${emojiId}` */
  emoji = new Map<string, { name: string; count: number }>();
  domains = new Map<string, { count: number; lastTs: number }>();

  get isEmpty(): boolean {
    return (
      this.events.length === 0 &&
      this.messageDeletes.length === 0 &&
      this.messageEdits.length === 0 &&
      // a rollup-only buffer (the rebuild path strips raw events) still counts as work
      this.daily.size === 0 &&
      this.hourly.size === 0 &&
      this.voice.size === 0 &&
      this.sessions.size === 0
    );
  }
}
