import { deleteDB } from "idb";
import { pruneEvents } from "../src/db/prune";
import { ALL_STORES, DB_NAME, openRetracedDb, type RetracedDatabase } from "../src/db/schema";
import { runSynthetic } from "../src/dev/synthetic";

/**
 * Storage measurement harness (spec §6: "measure real byte size against a
 * synthetic year in Phase 2"). Runs in a real browser so the numbers include
 * genuine IndexedDB overhead, then reports logical JSON bytes per store and
 * navigator.storage.estimate() before/after pruning the ring buffer to 30d.
 */

interface StoreMeasure {
  rows: number;
  bytes: number;
}

async function measureStore(db: RetracedDatabase, store: (typeof ALL_STORES)[number]): Promise<StoreMeasure> {
  const rows = (await db.getAll(store as never)) as unknown[];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const row of rows) bytes += encoder.encode(JSON.stringify(row)).length;
  return { rows: rows.length, bytes };
}

const status = (message: string): void => {
  document.body.textContent = message;
};

(async () => {
  const started = performance.now();
  status("resetting database…");
  await deleteDB(DB_NAME);
  const db = await openRetracedDb();

  status("generating a synthetic year…");
  const stats = await runSynthetic(db, {
    days: 365,
    seed: 20260716,
    endTs: Date.now(),
    onProgress: (n) => status(`generating a synthetic year… ${n.toLocaleString()} events`),
  });

  status("measuring stores…");
  const perStore: Record<string, StoreMeasure> = {};
  for (const store of ALL_STORES) perStore[store] = await measureStore(db, store);
  const estimateFullYear = (await navigator.storage.estimate())?.usage ?? 0;

  status("pruning ring buffer to 30 days…");
  const prunedEvents = await pruneEvents(db, Date.now() - 30 * 86_400_000);
  const eventsAfterPrune = await measureStore(db, "events");
  const estimateAfterPrune = (await navigator.storage.estimate())?.usage ?? 0;

  const logicalTotal = Object.values(perStore).reduce((n, s) => n + s.bytes, 0);
  const logicalSteadyState = logicalTotal - perStore.events!.bytes + eventsAfterPrune.bytes;

  (window as any).__measure = {
    events: stats.events,
    perStore,
    prunedEvents,
    eventsAfterPrune,
    estimateFullYear,
    estimateAfterPrune,
    logicalTotal,
    logicalSteadyState,
    elapsedMs: Math.round(performance.now() - started),
  };
  document.title = "MEASURE_DONE";
  status(`MEASURE_DONE ${JSON.stringify((window as any).__measure, null, 2)}`);
})().catch((e) => {
  document.title = "MEASURE_FAILED";
  status(`MEASURE_FAILED ${String(e?.stack ?? e)}`);
});
