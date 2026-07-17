// @vitest-environment node
// esbuild's JS API cannot load under jsdom (cross-realm Uint8Array check), so
// this file runs in a plain node environment. DOM-dependent lifecycle behavior
// is covered source-level in lifecycle.test.ts.
import { build, type BuildOptions } from "esbuild";
import React from "react";
import { describe, expect, test } from "vitest";
import { bdBanner, createBuildOptions } from "../scripts/esbuild.config.mjs";

async function bundle(): Promise<string> {
  const result = await build({ ...(createBuildOptions() as BuildOptions), write: false });
  expect(result.errors).toHaveLength(0);
  return result.outputFiles![0]!.text;
}

describe("plugin bundle", () => {
  test("starts with the BetterDiscord meta header", async () => {
    const text = await bundle();
    expect(text.startsWith("/**\n * @name Retraced\n")).toBe(true);
    expect(bdBanner).toContain("@author");
    expect(bdBanner).toContain("@version");
    expect(bdBanner).toContain("@description");
  });

  test("exports the plugin class through module.exports", async () => {
    const text = await bundle();
    expect(text).toContain("module.exports = __RetracedExports.default;");
  });

  test("uses Discord's React instead of bundling its own", async () => {
    const text = await bundle();
    expect(text).toContain("BdApi.React");
    // Markers that would only appear if a real React copy got bundled.
    expect(text).not.toContain("__SECRET_INTERNALS");
    expect(text).not.toContain("__CLIENT_INTERNALS");
    expect(text).not.toContain("react.development");
    expect(text).not.toContain("react.production");
  });

  test("makes no network calls — no fetch/XHR/WebSocket anywhere in the bundle", async () => {
    const text = await bundle();
    expect(text).not.toMatch(/\bfetch\s*\(/);
    expect(text).not.toContain("XMLHttpRequest");
    expect(text).not.toContain("new WebSocket");
  });

  test("evaluates under a BetterDiscord-style CommonJS wrapper and exposes the plugin class", async () => {
    const text = await bundle();
    const moduleShim: { exports: any } = { exports: {} };
    // BdApi is provided by the global test mock, exactly as BetterDiscord provides window.BdApi.
    // Executing `text` is safe and intentional: it is our own bundle, compiled seconds ago from
    // this repo's sources — this mirrors how BetterDiscord itself loads the plugin file.
    const run = new Function("module", "exports", text);
    run(moduleShim, moduleShim.exports);

    const PluginClass = moduleShim.exports;
    expect(typeof PluginClass).toBe("function");
    const instance = new PluginClass({ name: "Retraced" });
    expect(typeof instance.start).toBe("function");
    expect(typeof instance.stop).toBe("function");
    expect(typeof instance.getSettingsPanel).toBe("function");
    // Renders through the shims → BdApi.React, proving the alias chain works end to end.
    expect(React.isValidElement(instance.getSettingsPanel())).toBe(true);
  });
});
