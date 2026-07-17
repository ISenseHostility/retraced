import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import Retraced from "../src/index";
import type { BdApiMock } from "./bdapi-mock";

const bd = () => (globalThis as any).BdApi as BdApiMock;

const pressHotkey = () =>
  act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyH", key: "H", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );
  });

const pressEscape = () =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  });

const overlayEl = () => document.querySelector(".retraced-overlay");

let plugin: Retraced | null = null;
const makePlugin = () => (plugin = new Retraced({ name: "Retraced" }));

afterEach(async () => {
  await act(async () => plugin?.stop());
  plugin = null;
});

describe("plugin lifecycle", () => {
  test("constructing the plugin has no side effects", () => {
    makePlugin();
    expect(bd().DOM.addStyle).not.toHaveBeenCalled();
    expect(overlayEl()).toBeNull();
  });

  test("start() injects exactly one stylesheet; stop() removes it", () => {
    makePlugin()!.start();
    expect(bd().DOM.addStyle).toHaveBeenCalledTimes(1);
    const id = bd().DOM.addStyle.mock.calls[0]![0];
    plugin!.stop();
    expect(bd().DOM.removeStyle).toHaveBeenCalledWith(id);
    expect(bd().__styles.size).toBe(0);
  });

  test("calling start() twice is a no-op", () => {
    makePlugin()!.start();
    plugin!.start();
    expect(bd().DOM.addStyle).toHaveBeenCalledTimes(1);
  });

  test("stop() before start() does not throw", () => {
    expect(() => makePlugin()!.stop()).not.toThrow();
    expect(bd().DOM.removeStyle).not.toHaveBeenCalled();
  });

  test("stop() removes all Discord patches for this plugin", () => {
    makePlugin()!.start();
    plugin!.stop();
    expect(bd().Patcher.unpatchAll).toHaveBeenCalledWith("Retraced");
  });

  test("all keydown listeners added while running are removed by stop()", async () => {
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const origAdd = document.addEventListener.bind(document);
    const origRemove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, fn: unknown, opts?: unknown) => {
      if (type === "keydown") added.push(fn);
      return origAdd(type as any, fn as any, opts as any);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, fn: unknown, opts?: unknown) => {
      if (type === "keydown") removed.push(fn);
      return origRemove(type as any, fn as any, opts as any);
    }) as typeof document.removeEventListener;

    try {
      makePlugin()!.start();
      await pressHotkey(); // opens overlay, which adds its own Escape listener
      await act(async () => plugin!.stop());
      expect(removed).toEqual(expect.arrayContaining(added));
      expect(added.length).toBeGreaterThan(0);
    } finally {
      document.addEventListener = origAdd;
      document.removeEventListener = origRemove;
    }
  });
});

describe("stats page overlay", () => {
  test("Ctrl+Shift+H opens the page and it renders the Overview", async () => {
    makePlugin()!.start();
    expect(overlayEl()).toBeNull();
    await pressHotkey();
    expect(overlayEl()).not.toBeNull();
    const text = overlayEl()!.textContent!;
    expect(text).toMatch(/Retraced/);
    expect(text).toMatch(/night owl/i);
    expect(text).toMatch(/messages per day/i);
    expect(text).toMatch(/where your messages go/i);
    // fresh install in a DB-less environment: empty states with direction, plus the capture card
    expect(text).toMatch(/not enough data yet/i);
    expect(text).toMatch(/capture/i);
  });

  test("the time-range pills are present and switchable", async () => {
    makePlugin()!.start();
    await pressHotkey();
    const pills = [...document.querySelectorAll<HTMLButtonElement>(".retraced-range-pill")];
    expect(pills.map((p) => p.textContent)).toEqual(["30d", "90d", "1y", "All"]);
    expect(pills.find((p) => p.textContent === "90d")!.getAttribute("aria-pressed")).toBe("true");
    await act(async () => pills.find((p) => p.textContent === "All")!.click());
    expect(pills.find((p) => p.textContent === "All")!.getAttribute("aria-pressed")).toBe("true");
  });

  test("the hotkey toggles: pressing again closes", async () => {
    makePlugin()!.start();
    await pressHotkey();
    expect(overlayEl()).not.toBeNull();
    await pressHotkey();
    expect(overlayEl()).toBeNull();
  });

  test("Escape closes the page", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await pressEscape();
    expect(overlayEl()).toBeNull();
  });

  test("the page has the tab rail for all seven tabs", async () => {
    makePlugin()!.start();
    await pressHotkey();
    const tabs = [...document.querySelectorAll(".retraced-tab")].map((t) => t.textContent);
    expect(tabs).toEqual(["Overview", "Rhythm", "Hesitation", "People", "Content", "Voice", "Data"]);
  });

  test("the Rhythm tab renders its four chart cards", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>(".retraced-tab")].find((t) => t.textContent === "Rhythm")!.click()
    );
    const text = overlayEl()!.textContent!;
    expect(text).toMatch(/around the clock/i);
    expect(text).toMatch(/hour by hour/i);
    expect(text).toMatch(/night owl by month/i);
    expect(text).toMatch(/session lengths/i);
    // fresh DB-less environment: everything is an empty state, with direction
    expect(text).toMatch(/not enough data yet/i);
  });

  test("the Hesitation tab renders its five chart cards", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>(".retraced-tab")].find((t) => t.textContent === "Hesitation")!.click()
    );
    const text = overlayEl()!.textContent!;
    expect(text).toMatch(/hesitation over time/i);
    expect(text).toMatch(/where you hesitate/i);
    expect(text).toMatch(/who makes you hesitate/i);
    expect(text).toMatch(/edits and deletions/i);
    expect(text).toMatch(/time to delete/i);
    expect(text).toMatch(/not enough data yet/i);
  });

  test("the People tab renders its five chart cards", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>(".retraced-tab")].find((t) => t.textContent === "People")!.click()
    );
    const text = overlayEl()!.textContent!;
    expect(text).toMatch(/who reaches out first/i);
    expect(text).toMatch(/reply speed/i);
    expect(text).toMatch(/reply latency/i);
    expect(text).toMatch(/your circle/i);
    expect(text).toMatch(/reactions, given and received/i);
    expect(text).toMatch(/not enough data yet/i);
  });

  test("the Content tab renders its seven cards", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>(".retraced-tab")].find((t) => t.textContent === "Content")!.click()
    );
    const text = overlayEl()!.textContent!;
    expect(text).toMatch(/what your messages are made of/i);
    expect(text).toMatch(/custom emoji/i);
    expect(text).toMatch(/link domains/i);
    expect(text).toMatch(/vocabulary/i);
    expect(text).toMatch(/most-used words/i);
    expect(text).toMatch(/message length/i);
    expect(text).toMatch(/search your history/i);
    expect(text).toMatch(/not enough data yet/i);
  });

  test("the Voice tab renders its three cards", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>(".retraced-tab")].find((t) => t.textContent === "Voice")!.click()
    );
    const text = overlayEl()!.textContent!;
    expect(text).toMatch(/time in voice/i);
    expect(text).toMatch(/who you share voice with/i);
    expect(text).toMatch(/top voice channels/i);
    expect(text).toMatch(/not enough data yet/i);
  });

  test("the Data tab renders its management cards", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>(".retraced-tab")].find((t) => t.textContent === "Data")!.click()
    );
    const text = overlayEl()!.textContent!;
    expect(text).toMatch(/keep a copy/i);
    expect(text).toMatch(/export backup/i);
    expect(text).toMatch(/storage/i);
    expect(text).toMatch(/remove data/i);
    expect(text).toMatch(/content only/i);
    expect(text).toMatch(/repair/i);
    expect(text).toMatch(/rebuild/i);
  });

  test("the close button unmounts the page", async () => {
    makePlugin()!.start();
    await pressHotkey();
    const close = document.querySelector<HTMLButtonElement>(".retraced-close");
    expect(close).not.toBeNull();
    await act(async () => close!.click());
    expect(overlayEl()).toBeNull();
  });

  test("stop() closes an open overlay", async () => {
    makePlugin()!.start();
    await pressHotkey();
    await act(async () => plugin!.stop());
    expect(overlayEl()).toBeNull();
  });

  test("the hotkey does nothing after stop()", async () => {
    makePlugin()!.start();
    await act(async () => plugin!.stop());
    await pressHotkey();
    expect(overlayEl()).toBeNull();
  });

  test("plain H or Ctrl+H do not open the page", async () => {
    makePlugin()!.start();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", key: "h", bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", key: "h", ctrlKey: true, bubbles: true }));
    });
    expect(overlayEl()).toBeNull();
  });
});

describe("enable → disable → enable", () => {
  test("a full second cycle works without double-registration", async () => {
    makePlugin();
    plugin!.start();
    plugin!.stop();
    plugin!.start();
    expect(bd().DOM.addStyle).toHaveBeenCalledTimes(2);
    expect(bd().DOM.removeStyle).toHaveBeenCalledTimes(1);
    expect(bd().__styles.size).toBe(1);

    await pressHotkey();
    expect(overlayEl()).not.toBeNull();
    // exactly one overlay — a leaked second handler would have toggled it straight back off or doubled it
    expect(document.querySelectorAll(".retraced-overlay")).toHaveLength(1);

    await act(async () => plugin!.stop());
    expect(bd().__styles.size).toBe(0);
    expect(overlayEl()).toBeNull();
  });
});

describe("settings panel", () => {
  test("getSettingsPanel() returns a renderable React element", async () => {
    makePlugin()!.start();
    const panel = plugin!.getSettingsPanel();
    expect(React.isValidElement(panel)).toBe(true);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(panel));

    expect(host.textContent).toMatch(/Open statistics page/i);
    expect(host.textContent).toMatch(/Store message content/i);
    await act(async () => root.unmount());
  });

  test("the open button opens the stats overlay", async () => {
    makePlugin()!.start();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(plugin!.getSettingsPanel()));

    const button = [...host.querySelectorAll("button")].find((b) => /open statistics/i.test(b.textContent ?? ""));
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(overlayEl()).not.toBeNull();
    await act(async () => root.unmount());
  });

  test("toggling content storage persists the setting", async () => {
    makePlugin()!.start();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(plugin!.getSettingsPanel()));

    const checkbox = host.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(true);
    await act(async () => checkbox!.click());

    expect(bd().Data.save).toHaveBeenCalled();
    const saved: any = bd().__data.get("Retraced:settings");
    expect(saved.contentStorageEnabled).toBe(false);
    await act(async () => root.unmount());
  });
});
