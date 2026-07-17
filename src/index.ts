import { createElement, type ReactElement } from "react";
import meta from "../plugin.meta.json";
import { CaptureEngine } from "./capture/engine";
import { bd, log, PLUGIN_ID, warn } from "./env/bd";
import { Disposer } from "./lifecycle/disposer";
import { createDiscordHooks } from "./patcher/discord-hooks";
import { injectSettingsSection } from "./patcher/settings-menu";
import { SettingsStore } from "./settings";
import { SettingsPanel } from "./settings/panel";
import { OverlayController } from "./ui/overlay";
import { StatsPage } from "./ui/page/StatsPage";
import { css, STYLE_ID } from "./ui/styles";

/**
 * BetterDiscord plugin entry. The lifecycle contract this class must uphold:
 * enable → disable → enable any number of times with no leaked listeners,
 * timers, styles, patches, or mounted roots, and no double-counting. Every
 * side effect started in start() registers its undo on the Disposer.
 */
export default class Retraced {
  private disposer: Disposer | null = null;
  private overlay: OverlayController | null = null;
  private engine: CaptureEngine | null = null;
  private readonly settings = new SettingsStore();

  constructor(_bdMeta?: unknown) {}

  start(): void {
    if (this.disposer) return;
    const d = (this.disposer = new Disposer());

    try {
      this.settings.load();
    } catch (e) {
      warn("failed to load settings — using defaults", e);
    }

    bd().DOM.addStyle(STYLE_ID, css);
    d.add(() => bd().DOM.removeStyle(STYLE_ID));

    const engine = (this.engine = new CaptureEngine({
      hooks: createDiscordHooks(),
      settings: () => this.settings.get(),
    }));
    void engine.start().catch((e) => warn("capture failed to start", e));
    d.add(() => {
      void engine.stop().catch((e) => warn("capture stop failed", e));
    });

    // the kill switch purges as well as stops (spec §1.2)
    let contentWasEnabled = this.settings.get().contentStorageEnabled;
    d.add(
      this.settings.subscribe((s) => {
        if (contentWasEnabled && !s.contentStorageEnabled) {
          void engine.purgeContent().catch((e) => warn("content purge failed", e));
        }
        contentWasEnabled = s.contentStorageEnabled;
      })
    );

    const overlay = (this.overlay = new OverlayController((close) =>
      createElement(StatsPage, { variant: "overlay", engine, onClose: close })
    ));
    d.add(() => overlay.close());

    document.addEventListener("keydown", this.onHotkey, true);
    d.add(() => document.removeEventListener("keydown", this.onHotkey, true));

    try {
      injectSettingsSection(() => createElement(StatsPage, { variant: "settings", engine }));
    } catch (e) {
      warn("settings sidebar injection failed — the page is still available via Ctrl+Shift+H", e);
    }
    d.add(() => {
      try {
        bd().Patcher.unpatchAll(PLUGIN_ID);
      } catch {
        /* patcher unavailable — nothing left to undo */
      }
    });

    log(`v${meta.version} started — press Ctrl+Shift+H to open the stats page`);
  }

  stop(): void {
    if (!this.disposer) return;
    this.disposer.dispose();
    this.disposer = null;
    this.overlay = null;
    this.engine = null;
    log("stopped");
  }

  getSettingsPanel(): ReactElement {
    return createElement(SettingsPanel, {
      store: this.settings,
      onOpenStats: () => this.overlay?.open(),
    });
  }

  private onHotkey = (e: KeyboardEvent): void => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === "KeyH") {
      e.preventDefault();
      e.stopPropagation();
      this.overlay?.toggle();
    }
  };
}
