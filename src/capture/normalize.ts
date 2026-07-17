import { snowflakeToTs } from "../util/time";
import { isContentStorable } from "./content-rule";
import type {
  ChannelRef,
  ContentTypeFlags,
  EmojiUse,
  MessageCreatedEvent,
  MessageDeletedEvent,
  MessageEditedEvent,
  ReactionEvent,
} from "./types";

/**
 * Raw dispatcher actions → normalized capture events. This is the boundary
 * where the content rule is applied: nothing past this module ever sees text
 * it is not allowed to persist. Field reads are defensive (snake_case with
 * camelCase fallbacks) because Discord's action shapes drift.
 */

export interface NormalizeCtx {
  ownUserId: string;
  resolveChannel(channelId: string): ChannelRef;
  now(): number;
  /** the global kill switch (spec §1.2) — when false, no text is stored, period */
  contentStorageEnabled(): boolean;
}

/** Message `type`s that are real user chat: DEFAULT and REPLY. */
const CHAT_MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19]);
const EPHEMERAL_FLAG = 64;

const CUSTOM_EMOJI_RE = /<(a?):(\w+):(\d+)>/g;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const GIF_DOMAINS: ReadonlySet<string> = new Set(["tenor.com", "giphy.com", "gfycat.com"]);

export interface ContentAnalysis {
  chars: number;
  words: number;
  domains: string[];
  customEmoji: EmojiUse[];
}

export function analyzeContent(content: string): ContentAnalysis {
  const trimmed = content.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;

  const domains: string[] = [];
  for (const match of content.matchAll(URL_RE)) {
    try {
      let host = new URL(match[0]!).hostname.toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);
      if (host && !domains.includes(host)) domains.push(host);
    } catch {
      /* unparsable URL — skip */
    }
  }

  const customEmoji: EmojiUse[] = [];
  for (const match of content.matchAll(CUSTOM_EMOJI_RE)) {
    customEmoji.push({ name: match[2]!, id: match[3]! });
  }

  return { chars: content.length, words, domains, customEmoji };
}

function contentTypeFlags(msg: any, content: string, domains: string[]): ContentTypeFlags {
  const attachments: any[] = Array.isArray(msg.attachments) ? msg.attachments : [];
  const embeds: any[] = Array.isArray(msg.embeds) ? msg.embeds : [];
  const stickers: any[] = Array.isArray(msg.sticker_items ?? msg.stickerItems) ? (msg.sticker_items ?? msg.stickerItems) : [];

  const attachmentTypes = attachments.map((a) => String(a?.content_type ?? a?.contentType ?? ""));
  const gif =
    attachmentTypes.some((t) => t === "image/gif") ||
    embeds.some((e) => e?.type === "gifv") ||
    domains.some((d) => GIF_DOMAINS.has(d));
  const image =
    attachmentTypes.some((t) => t.startsWith("image/") && t !== "image/gif") ||
    embeds.some((e) => e?.type === "image");

  return {
    text: content.trim().length > 0,
    link: domains.length > 0,
    image,
    gif,
    sticker: stickers.length > 0,
    attachment: attachments.length > 0,
  };
}

function messageTs(msg: any, ctx: NormalizeCtx): number {
  const parsed = typeof msg.timestamp === "string" ? Date.parse(msg.timestamp) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return snowflakeToTs(msg.id) ?? ctx.now();
}

export function normalizeMessageCreate(action: any, ctx: NormalizeCtx): MessageCreatedEvent | null {
  if (action?.optimistic) return null;
  const msg = action?.message;
  if (!msg?.id || !msg?.author?.id) return null;
  if (msg.state === "SENDING") return null;
  const type = typeof msg.type === "number" ? msg.type : 0;
  if (!CHAT_MESSAGE_TYPES.has(type)) return null;
  if (typeof msg.flags === "number" && (msg.flags & EPHEMERAL_FLAG) !== 0) return null;

  const channelId = String(action.channelId ?? msg.channel_id ?? msg.channelId ?? "");
  if (!channelId) return null;
  const channel = ctx.resolveChannel(channelId);

  const authorId = String(msg.author.id);
  const isOwn = authorId === ctx.ownUserId;
  const rawContent = typeof msg.content === "string" ? msg.content : "";
  const analysis = analyzeContent(rawContent);

  const ref = msg.message_reference ?? msg.messageReference;
  const referenced = msg.referenced_message ?? msg.referencedMessage;
  const referencedTs = typeof referenced?.timestamp === "string" ? Date.parse(referenced.timestamp) : NaN;

  return {
    kind: "message-created",
    ts: messageTs(msg, ctx),
    channel,
    messageId: String(msg.id),
    authorId,
    isOwn,
    content: ctx.contentStorageEnabled() && isContentStorable({ isOwn, channelKind: channel.kind }) ? rawContent : null,
    chars: analysis.chars,
    words: analysis.words,
    contentTypes: contentTypeFlags(msg, rawContent, analysis.domains),
    replyToId: ref?.message_id ? String(ref.message_id) : (ref?.messageId ? String(ref.messageId) : null),
    replyToAuthorId: referenced?.author?.id ? String(referenced.author.id) : null,
    replyToTs: Number.isFinite(referencedTs) ? referencedTs : null,
    customEmoji: analysis.customEmoji,
    domains: analysis.domains,
  };
}

export function normalizeMessageUpdate(action: any, ctx: NormalizeCtx): MessageEditedEvent | null {
  const msg = action?.message;
  if (!msg?.id) return null;
  // Embed unfurls arrive as MESSAGE_UPDATE without an edited_timestamp — not edits.
  const editedRaw = msg.edited_timestamp ?? msg.editedTimestamp;
  const editedTs = typeof editedRaw === "string" ? Date.parse(editedRaw) : NaN;
  if (!Number.isFinite(editedTs)) return null;

  const channelId = String(action.channelId ?? msg.channel_id ?? msg.channelId ?? "");
  if (!channelId) return null;
  const channel = ctx.resolveChannel(channelId);

  // Partial updates can omit the author; fail closed (not own, no content).
  const authorId = msg.author?.id ? String(msg.author.id) : null;
  const isOwn = authorId === ctx.ownUserId;
  const rawContent = typeof msg.content === "string" ? msg.content : null;

  const originalTs = typeof msg.timestamp === "string" ? Date.parse(msg.timestamp) : (snowflakeToTs(msg.id) ?? NaN);

  return {
    kind: "message-edited",
    ts: editedTs,
    channel,
    messageId: String(msg.id),
    authorId,
    isOwn,
    content:
      rawContent !== null && ctx.contentStorageEnabled() && isContentStorable({ isOwn, channelKind: channel.kind })
        ? rawContent
        : null,
    editLatencyMs: Number.isFinite(originalTs) ? Math.max(0, editedTs - originalTs) : null,
  };
}

export function normalizeMessageDelete(action: any, ctx: NormalizeCtx): MessageDeletedEvent | null {
  const messageId = action?.id ?? action?.messageId;
  const channelId = action?.channelId ?? action?.channel_id;
  if (!messageId || !channelId) return null;
  return {
    kind: "message-deleted",
    ts: ctx.now(),
    messageId: String(messageId),
    channelId: String(channelId),
    guildId: action?.guildId ?? action?.guild_id ?? null,
  };
}

export function normalizeReaction(action: any, direction: 1 | -1, ctx: NormalizeCtx): ReactionEvent | null {
  const channelId = action?.channelId ?? action?.channel_id;
  const messageId = action?.messageId ?? action?.message_id;
  const actorId = action?.userId ?? action?.user_id;
  const emoji = action?.emoji;
  if (!channelId || !messageId || !actorId || typeof emoji?.name !== "string") return null;

  const messageAuthorId = action?.messageAuthorId ?? action?.message_author_id ?? null;
  return {
    kind: "reaction",
    ts: ctx.now(),
    channel: ctx.resolveChannel(String(channelId)),
    direction,
    actorId: String(actorId),
    actorIsOwn: String(actorId) === ctx.ownUserId,
    messageId: String(messageId),
    messageAuthorId: messageAuthorId ? String(messageAuthorId) : null,
    messageAuthorIsOwn: messageAuthorId ? String(messageAuthorId) === ctx.ownUserId : false,
    emoji: { id: emoji.id ? String(emoji.id) : null, name: emoji.name },
  };
}
