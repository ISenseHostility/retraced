import { describe, expect, test } from "vitest";
import Retraced from "../src/index";
import { SECTION_ID, spliceSections } from "../src/patcher/settings-menu";
import type { BdApiMock } from "./bdapi-mock";

const bd = () => (globalThis as any).BdApi as BdApiMock;
const element = () => null;

function baseSections() {
  return [
    { section: "HEADER", label: "User Settings" },
    { section: "My Account", label: "My Account" },
    { section: "DIVIDER" },
    { section: "logout", label: "Log Out" },
  ];
}

describe("spliceSections", () => {
  test("inserts a Retraced section before the logout entry", () => {
    const sections = baseSections();
    spliceSections(sections, element);
    const ids = sections.map((s: any) => s.section);
    const retracedIdx = ids.indexOf(SECTION_ID);
    expect(retracedIdx).toBeGreaterThan(-1);
    expect(retracedIdx).toBeLessThan(ids.indexOf("logout"));
    const entry: any = sections[retracedIdx];
    expect(entry.element).toBe(element);
    expect(entry.label).toBeTruthy();
  });

  test("is idempotent — patching a second time does not duplicate", () => {
    const sections = baseSections();
    spliceSections(sections, element);
    const once = sections.length;
    spliceSections(sections, element);
    expect(sections.length).toBe(once);
  });

  test("appends at the end when no logout anchor exists", () => {
    const sections: any[] = [{ section: "My Account" }];
    spliceSections(sections, element);
    expect(sections.some((s) => s.section === SECTION_ID)).toBe(true);
  });

  test("leaves non-array return values untouched", () => {
    expect(spliceSections(undefined as any, element)).toBeUndefined();
    expect(spliceSections(null as any, element)).toBeNull();
  });
});

describe("settings sidebar injection", () => {
  test("patches getPredicateSections when the SettingsView module is found", () => {
    class FakeSettingsView {
      getPredicateSections() {
        return baseSections();
      }
    }
    bd().Webpack.getModule.mockImplementation((filter: any) => (filter(FakeSettingsView) ? FakeSettingsView : undefined));

    const plugin = new Retraced({ name: "Retraced" });
    plugin.start();
    try {
      const patch = bd().__patches.find((p) => p.method === "getPredicateSections");
      expect(patch).toBeDefined();
      expect(patch!.caller).toBe("Retraced");
      expect(patch!.module).toBe(FakeSettingsView.prototype);

      const sections = baseSections();
      patch!.callback(null, [], sections);
      expect(sections.some((s: any) => s.section === SECTION_ID)).toBe(true);
    } finally {
      plugin.stop();
    }
  });

  test("degrades gracefully when the module is missing", () => {
    const plugin = new Retraced({ name: "Retraced" });
    expect(() => plugin.start()).not.toThrow();
    expect(bd().__patches.filter((p) => p.method === "getPredicateSections")).toHaveLength(0);
    plugin.stop();
  });
});
