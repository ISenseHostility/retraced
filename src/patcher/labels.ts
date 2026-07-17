import { findStore, lazy } from "./stores";

/**
 * Human labels for chart axes and nodes — live Discord lookups, fail-soft to
 * the raw id so charts never crash on a missing store.
 */

export interface LabelResolvers {
  guildLabel(guildId: string): string;
  channelLabel(channelId: string): string;
}

export function createLabelResolvers(): LabelResolvers {
  const getGuildStore = lazy(() => findStore("GuildStore"));
  const getChannelStore = lazy(() => findStore("ChannelStore"));
  const getUserStore = lazy(() => findStore("UserStore"));

  return {
    guildLabel(guildId) {
      try {
        return getGuildStore()?.getGuild?.(guildId)?.name ?? guildId;
      } catch {
        return guildId;
      }
    },
    channelLabel(channelId) {
      try {
        const channel = getChannelStore()?.getChannel?.(channelId);
        if (!channel) return channelId;
        if (channel.type === 1) {
          const recipientId = (channel.recipients ?? [])[0];
          const id = typeof recipientId === "string" ? recipientId : recipientId?.id;
          const user = id ? getUserStore()?.getUser?.(id) : null;
          const name = user?.globalName ?? user?.global_name ?? user?.username;
          return name ? `@${name}` : "a DM";
        }
        if (channel.type === 3) return channel.name || "group chat";
        return channel.name ? `#${channel.name}` : channelId;
      } catch {
        return channelId;
      }
    },
  };
}
