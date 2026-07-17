import { describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/settings";
import type { BdApiMock } from "./bdapi-mock";

const bd = () => (globalThis as any).BdApi as BdApiMock;

describe("SettingsStore", () => {
  test("load() returns defaults when nothing is stored", () => {
    const store = new SettingsStore();
    const s = store.load();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.contentStorageEnabled).toBe(true);
    expect(s.conversationGapMinutes).toBe(30);
    expect(s.eventRetentionDays).toBe(30);
  });

  test("load() merges stored values over defaults", () => {
    bd().Data.save("Retraced", "settings", { conversationGapMinutes: 45 });
    const store = new SettingsStore();
    const s = store.load();
    expect(s.conversationGapMinutes).toBe(45);
    expect(s.contentStorageEnabled).toBe(DEFAULT_SETTINGS.contentStorageEnabled);
    expect(s.eventRetentionDays).toBe(DEFAULT_SETTINGS.eventRetentionDays);
  });

  test("update() persists and a fresh store loads the same values", () => {
    const store = new SettingsStore();
    store.load();
    store.update({ contentStorageEnabled: false });
    expect(store.get().contentStorageEnabled).toBe(false);

    const fresh = new SettingsStore();
    expect(fresh.load().contentStorageEnabled).toBe(false);
  });

  test("subscribers are notified on update and can unsubscribe", () => {
    const store = new SettingsStore();
    store.load();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.update({ eventRetentionDays: 60 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get().eventRetentionDays).toBe(60);

    unsubscribe();
    store.update({ eventRetentionDays: 90 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("get() before load() still returns defaults", () => {
    const store = new SettingsStore();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });
});
