import { tokenize } from "../util/tokenize";
import type { RetracedDatabase } from "./schema";

/**
 * Ring-buffer discipline for `events` (rebuild log, default 30 days) and the
 * optional `messages` retention. Runs on start and on a slow timer.
 */

export async function pruneEvents(db: RetracedDatabase, cutoffTs: number): Promise<number> {
  const tx = db.transaction("events", "readwrite");
  let removed = 0;
  let cursor = await tx.store.index("ts").openCursor(IDBKeyRange.upperBound(cutoffTs, true));
  while (cursor) {
    await cursor.delete();
    removed++;
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}

export async function pruneMessages(db: RetracedDatabase, cutoffTs: number): Promise<number> {
  const tx = db.transaction(["messages", "searchIndex"], "readwrite");
  const searchIndex = tx.objectStore("searchIndex");
  let removed = 0;
  let cursor = await tx.objectStore("messages").index("ts").openCursor(IDBKeyRange.upperBound(cutoffTs, true));
  while (cursor) {
    // a pruned message takes its index postings with it — orphans would pile up forever
    const row = cursor.value;
    if (row.content !== null) {
      for (const term of new Set(tokenize(row.content))) {
        void searchIndex.delete([term, row.messageId]);
      }
    }
    await cursor.delete();
    removed++;
    cursor = await cursor.continue();
  }
  await tx.done;
  return removed;
}
