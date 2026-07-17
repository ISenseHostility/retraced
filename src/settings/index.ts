import { bd, PLUGIN_ID } from "../env/bd";

export interface RetracedSettings {
  schemaVersion: 1;
  /** Global kill switch for storing message text (Phase 2+ honours this everywhere). */
  contentStorageEnabled: boolean;
  /** Silence longer than this starts a new conversation (initiation attribution). */
  conversationGapMinutes: number;
  /** Retention of the rebuildable raw event ring buffer, in days. */
  eventRetentionDays: number;
  /** Retention of the messages store, in days. 0 = unlimited (spec default). */
  messagesRetentionDays: number;
  /** Filtered out of the most-used-words charts at render time (editable). */
  stopWords: string[];
}

/** Render-time filter only — the words store keeps everything, so edits apply retroactively. */
export const DEFAULT_STOPWORDS: readonly string[] = [
  "a", "an", "the", "and", "or", "but", "if", "so", "as", "of", "at", "by", "for", "with", "about", "into", "through",
  "to", "from", "up", "down", "in", "out", "on", "off", "over", "under", "again", "once", "here", "there", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "than",
  "too", "very", "can", "will", "just", "now", "i", "im", "i'm", "me", "my", "we", "our", "u", "you", "your", "he",
  "him", "his", "she", "her", "it", "its", "it's", "they", "them", "their", "what", "which", "who", "this", "that",
  "these", "those", "am", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "dont", "don't", "yeah", "yes", "ok", "okay", "lol", "like",
];

export const DEFAULT_SETTINGS: RetracedSettings = Object.freeze({
  schemaVersion: 1,
  contentStorageEnabled: true,
  conversationGapMinutes: 30,
  eventRetentionDays: 30,
  messagesRetentionDays: 0,
  stopWords: [...DEFAULT_STOPWORDS],
});

const DATA_KEY = "settings";

/**
 * Settings live in BdApi.Data (JSON file) — fine at this size. Everything else
 * (events, messages, rollups) belongs to IndexedDB from Phase 2 onward.
 */
export class SettingsStore {
  private value: RetracedSettings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<(s: RetracedSettings) => void>();

  load = (): RetracedSettings => {
    const raw = bd()?.Data?.load?.(PLUGIN_ID, DATA_KEY);
    this.value = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === "object" ? raw : {}) };
    return this.value;
  };

  get = (): RetracedSettings => this.value;

  update = (patch: Partial<RetracedSettings>): void => {
    this.value = { ...this.value, ...patch };
    bd()?.Data?.save?.(PLUGIN_ID, DATA_KEY, this.value);
    for (const fn of [...this.listeners]) fn(this.value);
  };

  subscribe = (fn: (s: RetracedSettings) => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}
