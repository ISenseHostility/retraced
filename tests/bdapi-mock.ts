import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { vi } from "vitest";

export interface RegisteredPatch {
  caller: string;
  module: unknown;
  method: string;
  callback: (thisObj: unknown, args: unknown[], ret: unknown) => unknown;
  unpatch: () => void;
  active: boolean;
}

export function createBdApiMock() {
  const dataStore = new Map<string, unknown>();
  const styles = new Map<string, string>();
  const patches: RegisteredPatch[] = [];

  return {
    React,
    ReactDOM: {
      createRoot: (container: Element) => ReactDOMClient.createRoot(container),
    },
    Data: {
      load: vi.fn((plugin: string, key: string) => dataStore.get(`${plugin}:${key}`)),
      save: vi.fn((plugin: string, key: string, value: unknown) => {
        dataStore.set(`${plugin}:${key}`, value);
      }),
      delete: vi.fn((plugin: string, key: string) => {
        dataStore.delete(`${plugin}:${key}`);
      }),
    },
    DOM: {
      addStyle: vi.fn((id: string, css: string) => {
        styles.set(id, css);
      }),
      removeStyle: vi.fn((id: string) => {
        styles.delete(id);
      }),
    },
    Patcher: {
      after: vi.fn((caller: string, module: unknown, method: string, callback: RegisteredPatch["callback"]) => {
        const patch: RegisteredPatch = {
          caller,
          module,
          method,
          callback,
          active: true,
          unpatch: () => {
            patch.active = false;
          },
        };
        patches.push(patch);
        return patch.unpatch;
      }),
      unpatchAll: vi.fn((caller: string) => {
        for (const p of patches) if (p.caller === caller) p.active = false;
      }),
    },
    Webpack: {
      getModule: vi.fn((..._args: any[]): any => undefined),
      Filters: {
        byPrototypeKeys:
          (...keys: string[]) =>
          (m: any) =>
            keys.every((k) => typeof m?.prototype?.[k] !== "undefined"),
      },
    },
    UI: {
      showToast: vi.fn(),
    },
    Logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    __styles: styles,
    __patches: patches,
    __data: dataStore,
  };
}

export type BdApiMock = ReturnType<typeof createBdApiMock>;
