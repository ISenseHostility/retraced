import type { ChannelKind } from "./content-rule";

export interface ChannelRef {
  channelId: string;
  guildId: string | null;
  kind: ChannelKind;
}

export interface ContentTypeFlags {
  text: boolean;
  image: boolean;
  link: boolean;
  gif: boolean;
  sticker: boolean;
  attachment: boolean;
}

export interface EmojiUse {
  id: string;
  name: string;
}

export interface MessageCreatedEvent {
  kind: "message-created";
  ts: number;
  channel: ChannelRef;
  messageId: string;
  authorId: string;
  isOwn: boolean;
  /** null ⇔ not storable under the content rule. Never an empty-string marker. */
  content: string | null;
  chars: number;
  words: number;
  contentTypes: ContentTypeFlags;
  replyToId: string | null;
  replyToAuthorId: string | null;
  replyToTs: number | null;
  customEmoji: EmojiUse[];
  domains: string[];
}

export interface MessageEditedEvent {
  kind: "message-edited";
  /** the edit timestamp */
  ts: number;
  channel: ChannelRef;
  messageId: string;
  authorId: string | null;
  isOwn: boolean;
  /** new content, null when not storable */
  content: string | null;
  /** time from original send to this edit, when the original ts is known */
  editLatencyMs: number | null;
}

export interface MessageDeletedEvent {
  kind: "message-deleted";
  ts: number;
  channelId: string;
  guildId: string | null;
  messageId: string;
}

export interface TypingResolvedEvent {
  kind: "typing-resolved";
  /** resolution time */
  ts: number;
  channel: ChannelRef;
  startedAt: number;
  durationMs: number;
  committed: boolean;
  /** 1:1 DM peer, when resolvable */
  peerId: string | null;
}

export interface ReactionEvent {
  kind: "reaction";
  ts: number;
  channel: ChannelRef;
  direction: 1 | -1;
  actorId: string;
  actorIsOwn: boolean;
  messageId: string;
  messageAuthorId: string | null;
  messageAuthorIsOwn: boolean;
  emoji: { id: string | null; name: string };
}

export interface DwellEvent {
  kind: "dwell";
  /** segment start */
  ts: number;
  channel: ChannelRef;
  durationMs: number;
}

export interface VoiceSegmentEvent {
  kind: "voice-segment";
  /** segment start */
  ts: number;
  channel: ChannelRef;
  seconds: number;
  /** userId -> seconds shared during this segment */
  coPresent: Record<string, number>;
}

export type CapturedEvent =
  | MessageCreatedEvent
  | MessageEditedEvent
  | MessageDeletedEvent
  | TypingResolvedEvent
  | ReactionEvent
  | DwellEvent
  | VoiceSegmentEvent;
