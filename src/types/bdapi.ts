import type * as ReactNS from "react";

/**
 * The subset of BetterDiscord's `BdApi` that Retraced touches. Kept deliberately
 * narrow and optional-heavy: every consumer must tolerate missing pieces, because
 * BD versions differ and Discord updates break internals.
 */
export interface BdApiLike {
  React: typeof ReactNS;
  ReactDOM: {
    createRoot?(container: Element): { render(node: unknown): void; unmount(): void };
    render?(node: unknown, container: Element): void;
    unmountComponentAtNode?(container: Element): boolean;
  };
  Data: {
    load(plugin: string, key: string): unknown;
    save(plugin: string, key: string, value: unknown): void;
    delete?(plugin: string, key: string): void;
  };
  DOM: {
    addStyle(id: string, css: string): void;
    removeStyle(id: string): void;
  };
  Patcher: {
    after(
      caller: string,
      module: object,
      method: string,
      callback: (thisObj: unknown, args: unknown[], returnValue: unknown) => unknown
    ): () => void;
    unpatchAll(caller: string): void;
  };
  Webpack?: {
    getModule?(filter: (m: any) => boolean, options?: { searchExports?: boolean; defaultExport?: boolean }): any;
    Filters?: Record<string, (...args: any[]) => (m: any) => boolean>;
  };
  UI?: {
    showToast?(content: string, options?: Record<string, unknown>): void;
  };
  Logger?: {
    info?(pluginName: string, ...args: unknown[]): void;
    warn?(pluginName: string, ...args: unknown[]): void;
    error?(pluginName: string, ...args: unknown[]): void;
  };
}
