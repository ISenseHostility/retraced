import { bd, warn } from "../env/bd";

export interface GetModuleOptions {
  searchExports?: boolean;
  defaultExport?: boolean;
}

const warned = new Set<string>();

function warnOnce(key: string, ...args: unknown[]): void {
  if (warned.has(key)) return;
  warned.add(key);
  warn(...args);
}

/**
 * Every Discord-internal webpack lookup goes through here. A miss is a warning
 * and a degraded feature — never a crash. Discord updates break these finds
 * routinely; the plugin must keep working around the hole.
 */
export function safeGetModule(filter: (m: any) => boolean, options: GetModuleOptions, what: string): any {
  try {
    const mod = bd()?.Webpack?.getModule?.(filter, options);
    if (!mod) {
      warnOnce(what, `could not locate ${what} — the dependent feature is disabled until a plugin update catches up with Discord`);
      return null;
    }
    return mod;
  } catch (e) {
    warnOnce(what, `lookup for ${what} threw — the dependent feature is disabled`, e);
    return null;
  }
}
