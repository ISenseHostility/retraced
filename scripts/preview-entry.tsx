import React from "react";
import { createRoot } from "react-dom/client";
import { CaptureEngine, type CaptureHooks } from "../src/capture/engine";
import { wipeAll } from "../src/db/wipe";
import { runSynthetic } from "../src/dev/synthetic";
import { DEFAULT_SETTINGS } from "../src/settings";
import { StatsPage } from "../src/ui/page/StatsPage";
import { css } from "../src/ui/styles";

/**
 * Dev-only visual harness: the real StatsPage against a synthetic history in a
 * real browser, with Discord-ish theme variables and plausible labels. Never
 * ships in the plugin bundle.
 */

const GUILD_NAMES: Record<string, string> = { g1: "Design Server", g2: "Gaming Crew", g3: "Study Group" };
const USER_NAMES: Record<string, string> = {
  "2001": "alex",
  "2002": "sam",
  "2003": "jo",
  "2004": "max",
  "2005": "kit",
  "2006": "ren",
  "2007": "ash",
  "2008": "lee",
};

const fakeStores: Record<string, unknown> = {
  GuildStore: { getGuild: (id: string) => ({ name: GUILD_NAMES[id] ?? id }) },
  ChannelStore: {
    getChannel: (id: string) => {
      if (id.startsWith("dm-")) return { type: 1, recipients: [id.slice(3)] };
      if (id === "group-1") return { type: 3, name: "the group chat" };
      return { type: 0, name: id.replace(/^g\d-/, "") };
    },
  },
  UserStore: { getUser: (id: string) => ({ username: USER_NAMES[id] ?? `user-${id}` }) },
};

(globalThis as any).BdApi = {
  React,
  ReactDOM: {},
  Logger: { info: console.log, warn: console.warn, error: console.error },
  Data: { load: () => undefined, save: () => undefined },
  DOM: { addStyle: () => undefined, removeStyle: () => undefined },
  Patcher: { after: () => () => undefined, unpatchAll: () => undefined },
  Webpack: { getStore: (name: string) => fakeStores[name], getModule: () => undefined },
};

const stubHooks: CaptureHooks = {
  subscribeDispatch: () => null,
  patchTyping: () => null,
  getOwnUserId: () => "1000",
  resolveChannel: (id) => ({
    channelId: id,
    guildId: id.startsWith("dm-") || id === "group-1" ? null : id.split("-")[0]!,
    kind: id.startsWith("dm-") ? "dm" : id === "group-1" ? "group-dm" : "guild",
  }),
  resolveDmRecipients: (id) => (id.startsWith("dm-") ? [id.slice(3)] : null),
  resolveUser: (id) => ({ label: USER_NAMES[id] ?? `user-${id}`, avatarHash: null }),
  getVoiceChannelMembers: () => null,
};

(async () => {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const engine = new CaptureEngine({ hooks: stubHooks, settings: () => ({ ...DEFAULT_SETTINGS }) });
  await engine.start();

  const db = engine.getDb();
  if (!db) {
    document.body.textContent = "PREVIEW_FAILED: no db";
    return;
  }
  // reseed whenever the seed recipe (or schema-relevant capture logic) changes
  const SEED = "v5-540d-seed7"; // bumped after the Phase 7 wipe test emptied the content stores
  if ((await db.get("meta", "previewSeed")) !== SEED) {
    document.title = "seeding…";
    await wipeAll(db);
    await runSynthetic(db, { days: 540, seed: 7, endTs: Date.now() });
    await db.put("meta", SEED, "previewSeed");
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<StatsPage variant="overlay" engine={engine} />);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.title = "PREVIEW_READY";
    });
  });
})().catch((e) => {
  document.title = "PREVIEW_FAILED";
  document.body.textContent = `PREVIEW_FAILED ${String((e as Error)?.stack ?? e)}`;
});
