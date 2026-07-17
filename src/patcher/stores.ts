import { bd } from "../env/bd";
import { safeGetModule } from "./webpack";

/** Shared lazy, fail-soft Discord store lookup. */

const UNRESOLVED = Symbol("unresolved");

export function lazy<T>(resolve: () => T): () => T {
  let value: T | typeof UNRESOLVED = UNRESOLVED;
  return () => {
    if (value === UNRESOLVED) value = resolve();
    return value;
  };
}

export function findStore(name: string): any {
  try {
    const viaApi = (bd()?.Webpack as any)?.getStore?.(name);
    if (viaApi) return viaApi;
  } catch {
    /* getStore unavailable on this BD version */
  }
  return safeGetModule((m: any) => typeof m?.getName === "function" && m.getName() === name, { searchExports: true }, `${name}`);
}
