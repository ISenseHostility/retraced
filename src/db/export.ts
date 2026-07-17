import { ALL_STORES, DB_VERSION, type RetracedDatabase } from "./schema";
import { wipeAll } from "./wipe";

/**
 * Whole-database backup as one JSON envelope. Import REPLACES the current
 * contents — the round-trip is the user's insurance against Discord wiping
 * IndexedDB on a reinstall.
 */

export interface ExportEnvelope {
  format: "retraced-export";
  version: number;
  exportedAt: number;
  /** rows per store; `meta` is [key, value] pairs since its keys are out-of-line */
  stores: Record<string, unknown[]>;
}

export async function exportAll(db: RetracedDatabase): Promise<ExportEnvelope> {
  const stores: Record<string, unknown[]> = {};
  for (const name of ALL_STORES) {
    if (name === "meta") {
      const tx = db.transaction("meta");
      const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
      stores.meta = keys.map((key, i) => [key, values[i]]);
    } else {
      stores[name] = await db.getAll(name);
    }
  }
  return { format: "retraced-export", version: DB_VERSION, exportedAt: Date.now(), stores };
}

/** Throws on anything that is not a plausible envelope — BEFORE touching the database. */
function validate(envelope: ExportEnvelope): void {
  if (!envelope || typeof envelope !== "object") throw new Error("not a Retraced export");
  if (envelope.format !== "retraced-export") throw new Error("not a Retraced export");
  if (typeof envelope.version !== "number" || envelope.version < 1 || envelope.version > DB_VERSION) {
    throw new Error(`unsupported export version ${String(envelope.version)} (this build reads up to v${DB_VERSION})`);
  }
  if (!envelope.stores || typeof envelope.stores !== "object") throw new Error("export has no stores");
  for (const rows of Object.values(envelope.stores)) {
    if (!Array.isArray(rows)) throw new Error("malformed store payload");
  }
}

export async function importAll(db: RetracedDatabase, envelope: ExportEnvelope): Promise<{ rows: number }> {
  validate(envelope);
  await wipeAll(db);

  let rows = 0;
  const tx = db.transaction([...ALL_STORES], "readwrite");
  for (const name of ALL_STORES) {
    const payload = envelope.stores[name];
    if (!payload) continue; // older exports may predate newer stores
    const store = tx.objectStore(name);
    if (name === "meta") {
      for (const entry of payload as Array<[string, unknown]>) {
        void store.put(entry[1], entry[0]);
        rows++;
      }
    } else {
      for (const row of payload) {
        void store.put(row as never);
        rows++;
      }
    }
  }
  await tx.done;
  return { rows };
}
