import { classifyChannel } from "../capture/content-rule";
import type { CaptureHooks } from "../capture/engine";
import type { ChannelRef } from "../capture/types";
import { bd, PLUGIN_ID, warn } from "../env/bd";
import { findStore, lazy } from "./stores";
import { safeGetModule } from "./webpack";

/**
 * The one place Retraced touches live Discord internals for capture. Every
 * lookup fails soft: a missing module disables its feature and logs once.
 * Channel classification failing means kind "unknown", which the content rule
 * treats as not-a-DM — misses can only ever store LESS, never more.
 */

interface DispatcherLike {
  subscribe(type: string, handler: (action: any) => void): void;
  unsubscribe(type: string, handler: (action: any) => void): void;
}

export function createDiscordHooks(): CaptureHooks {
  const getDispatcher = lazy<DispatcherLike | null>(() =>
    safeGetModule(
      (m: any) => typeof m?.dispatch === "function" && typeof m?.subscribe === "function" && typeof m?.unsubscribe === "function",
      { searchExports: true },
      "Flux dispatcher"
    )
  );
  const getUserStore = lazy(() => findStore("UserStore"));
  const getChannelStore = lazy(() => findStore("ChannelStore"));
  const getVoiceStateStore = lazy(() => findStore("VoiceStateStore"));

  return {
    subscribeDispatch(type, handler) {
      const dispatcher = getDispatcher();
      if (!dispatcher) return null;
      const safeHandler = (action: any): void => {
        try {
          handler(action);
        } catch (e) {
          warn(`capture handler for ${type} failed`, e);
        }
      };
      try {
        dispatcher.subscribe(type, safeHandler);
      } catch (e) {
        warn(`could not subscribe to ${type}`, e);
        return null;
      }
      return () => {
        try {
          dispatcher.unsubscribe(type, safeHandler);
        } catch {
          /* dispatcher gone at teardown — nothing to undo */
        }
      };
    },

    patchTyping(onStart, onStop) {
      const typingModule = safeGetModule(
        (m: any) => typeof m?.startTyping === "function" && typeof m?.stopTyping === "function",
        { searchExports: true },
        "typing module (startTyping/stopTyping)"
      );
      if (!typingModule) return null;
      const patcher = bd().Patcher;
      const unpatchStart = patcher.after(PLUGIN_ID, typingModule, "startTyping", (_this, args: any[]) => {
        const channelId = args?.[0];
        if (channelId) onStart(String(channelId));
      });
      const unpatchStop = patcher.after(PLUGIN_ID, typingModule, "stopTyping", (_this, args: any[]) => {
        const channelId = args?.[0];
        if (channelId) onStop(String(channelId));
      });
      return () => {
        try {
          unpatchStart();
          unpatchStop();
        } catch {
          /* already unpatched via unpatchAll */
        }
      };
    },

    getOwnUserId() {
      try {
        const id = getUserStore()?.getCurrentUser?.()?.id;
        return id ? String(id) : null;
      } catch {
        return null;
      }
    },

    resolveChannel(channelId): ChannelRef {
      try {
        const channel = getChannelStore()?.getChannel?.(channelId);
        let guildId: unknown = channel?.guild_id ?? channel?.guildId;
        if (guildId === undefined && typeof channel?.getGuildId === "function") guildId = channel.getGuildId();
        return {
          channelId,
          guildId: guildId ? String(guildId) : null,
          kind: classifyChannel(channel),
        };
      } catch {
        return { channelId, guildId: null, kind: "unknown" };
      }
    },

    resolveDmRecipients(channelId) {
      try {
        const channel = getChannelStore()?.getChannel?.(channelId);
        const recipients: unknown = channel?.recipients ?? channel?.recipientIds;
        if (!Array.isArray(recipients)) return null;
        const ids = recipients.map((r: any) => (typeof r === "string" ? r : r?.id)).filter(Boolean).map(String);
        return ids.length > 0 ? ids : null;
      } catch {
        return null;
      }
    },

    resolveUser(userId) {
      try {
        const user = getUserStore()?.getUser?.(userId);
        if (!user) return null;
        return {
          label: user.globalName ?? user.global_name ?? user.username ?? null,
          avatarHash: user.avatar ?? null,
        };
      } catch {
        return null;
      }
    },

    getVoiceChannelMembers(channelId) {
      try {
        const states = getVoiceStateStore()?.getVoiceStatesForChannel?.(channelId);
        return states && typeof states === "object" ? Object.keys(states) : null;
      } catch {
        return null;
      }
    },
  };
}
