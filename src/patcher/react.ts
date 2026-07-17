import type { ReactNode } from "react";
import { bd, warn } from "../env/bd";
import { safeGetModule } from "./webpack";

export interface RootLike {
  render(node: ReactNode): void;
  unmount(): void;
}

/**
 * Fail-soft React root factory. Tries, in order: BdApi.ReactDOM.createRoot,
 * a webpack search for createRoot, then legacy ReactDOM.render. Returns null
 * (with a warning) if Discord's React can't give us a root at all.
 */
export function createRootIn(container: HTMLElement): RootLike | null {
  const reactDom = bd()?.ReactDOM;

  if (typeof reactDom?.createRoot === "function") {
    try {
      return reactDom.createRoot(container) as RootLike;
    } catch (e) {
      warn("BdApi.ReactDOM.createRoot threw — trying fallbacks", e);
    }
  }

  const mod = safeGetModule((m: any) => typeof m?.createRoot === "function", { searchExports: true }, "ReactDOM.createRoot");
  if (mod) {
    try {
      return mod.createRoot(container) as RootLike;
    } catch (e) {
      warn("webpack-located createRoot threw — trying legacy render", e);
    }
  }

  if (typeof reactDom?.render === "function") {
    return {
      render: (node) => reactDom.render!(node, container),
      unmount: () => void reactDom.unmountComponentAtNode?.(container),
    };
  }

  warn("no usable React root factory — the stats page cannot render");
  return null;
}
