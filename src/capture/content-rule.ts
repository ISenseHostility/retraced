/**
 * THE CONTENT RULE — the single place Retraced decides whether message text
 * may be written to disk (spec §1.2, non-negotiable):
 *
 *   - DMs and group DMs: BOTH sides stored in full.
 *   - Guild channels (including threads, voice-text, forums, stages): the
 *     user's OWN messages only. Other people's guild messages still produce
 *     counts, rollups and content-type flags, but their text never reaches
 *     storage — it is nulled at the capture layer, before any buffer or store.
 *
 * Classification is by channel TYPE, never by "has no guildId": threads carry
 * a guildId and new/unknown channel types must fail CLOSED (treated as
 * not-DM), so an unclassifiable channel can never leak someone else's text.
 */

export type ChannelKind = "dm" | "group-dm" | "guild" | "guild-thread" | "unknown";

/** Discord channel `type` values (discord-api-types ChannelType). */
const DM_TYPE = 1;
const GROUP_DM_TYPE = 3;
const THREAD_TYPES: ReadonlySet<number> = new Set([10, 11, 12]);
const GUILD_TYPES: ReadonlySet<number> = new Set([0, 2, 4, 5, 13, 14, 15, 16]);

export function classifyChannel(channel: { type?: unknown; guild_id?: unknown } | null | undefined): ChannelKind {
  const type = channel?.type;
  if (typeof type !== "number") return "unknown";
  if (type === DM_TYPE) return "dm";
  if (type === GROUP_DM_TYPE) return "group-dm";
  if (THREAD_TYPES.has(type)) return "guild-thread";
  if (GUILD_TYPES.has(type)) return "guild";
  return "unknown";
}

export function isContentStorable(input: { isOwn: boolean; channelKind: ChannelKind }): boolean {
  return input.isOwn || input.channelKind === "dm" || input.channelKind === "group-dm";
}
