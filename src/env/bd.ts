import meta from "../../plugin.meta.json";
import type { BdApiLike } from "../types/bdapi";

export const PLUGIN_ID: string = meta.name;
export const PLUGIN_VERSION: string = meta.version;

/** Single access point for BetterDiscord's global. Never cache the result across start/stop. */
export function bd(): BdApiLike {
  return (globalThis as { BdApi?: BdApiLike }).BdApi as BdApiLike;
}

export function log(...args: unknown[]): void {
  const logger = bd()?.Logger;
  if (logger?.info) logger.info(PLUGIN_ID, ...args);
  else console.log(`[${PLUGIN_ID}]`, ...args);
}

export function warn(...args: unknown[]): void {
  const logger = bd()?.Logger;
  if (logger?.warn) logger.warn(PLUGIN_ID, ...args);
  else console.warn(`[${PLUGIN_ID}]`, ...args);
}
