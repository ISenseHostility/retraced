import { bd, PLUGIN_ID } from "../env/bd";
import { safeGetModule } from "./webpack";

export const SECTION_ID = "retraced";

interface SidebarSection {
  section: string;
  label?: string;
  element?: () => unknown;
}

/**
 * Splices the Retraced entry into Discord's user-settings sidebar section list.
 * Pure — exported for tests. Idempotent because getPredicateSections runs on
 * every settings render.
 */
export function spliceSections(sections: SidebarSection[], element: () => unknown): SidebarSection[] {
  if (!Array.isArray(sections)) return sections;
  if (sections.some((s) => s?.section === SECTION_ID)) return sections;

  const entry: SidebarSection[] = [
    { section: "HEADER", label: "Retraced" },
    { section: SECTION_ID, label: "Statistics", element },
    { section: "DIVIDER" },
  ];

  const anchor = sections.findIndex((s) => typeof s?.section === "string" && s.section.toLowerCase() === "logout");
  if (anchor === -1) sections.push(...entry);
  else sections.splice(anchor, 0, ...entry);
  return sections;
}

/**
 * Best-effort injection into the user settings sidebar — the least fragile
 * named mount point Discord offers, but still a webpack find that can break on
 * any Discord update. When it fails the page stays reachable via the hotkey
 * and the plugin settings panel; that degradation is deliberate.
 */
export function injectSettingsSection(element: () => unknown): boolean {
  const settingsView = safeGetModule(
    (m: any) => typeof m?.prototype?.getPredicateSections === "function",
    { searchExports: true },
    "user settings sidebar (SettingsView)"
  );
  if (!settingsView) return false;

  bd().Patcher.after(PLUGIN_ID, settingsView.prototype, "getPredicateSections", (_this, _args, ret) =>
    spliceSections(ret as SidebarSection[], element)
  );
  return true;
}
