import { dateKey } from "../util/time";
import { tokenize } from "../util/tokenize";
import { ALL_STORES, type RetracedDatabase } from "./schema";

/**
 * The Data-tab removal operations (spec §1.2: they are not an afterthought —
 * DM content is real personal data about real people).
 */

export async function wipeAll(db: RetracedDatabase): Promise<void> {
  const tx = db.transaction([...ALL_STORES], "readwrite");
  for (const store of ALL_STORES) {
    void tx.objectStore(store).clear();
  }
  await tx.done;
}

/**
 * Drops every piece of stored TEXT — messages, the search index, word counts,
 * and the content carried inside ring-buffer events — while keeping every
 * rollup. This is also what flipping the content kill switch off runs.
 */
export async function wipeContentOnly(db: RetracedDatabase): Promise<void> {
  const tx = db.transaction(["messages", "searchIndex", "words", "events"], "readwrite");
  void tx.objectStore("messages").clear();
  void tx.objectStore("searchIndex").clear();
  void tx.objectStore("words").clear();

  let cursor = await tx.objectStore("events").openCursor();
  while (cursor) {
    const row = cursor.value;
    if (typeof (row.event as { content?: string | null }).content === "string") {
      const cloned = { ...row, event: { ...row.event } };
      (cloned.event as { content: string | null }).content = null;
      void cursor.update(cloned);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Removes one person: their peer row, their messages (+postings), their events. */
export async function wipePeer(db: RetracedDatabase, userId: string): Promise<void> {
  const tx = db.transaction(["peers", "messages", "searchIndex", "events"], "readwrite");
  void tx.objectStore("peers").delete(userId);

  const searchIndex = tx.objectStore("searchIndex");
  let msgCursor = await tx.objectStore("messages").index("authorId").openCursor(IDBKeyRange.only(userId));
  while (msgCursor) {
    const row = msgCursor.value;
    if (row.content !== null) {
      for (const term of new Set(tokenize(row.content))) void searchIndex.delete([term, row.messageId]);
    }
    await msgCursor.delete();
    msgCursor = await msgCursor.continue();
  }

  let evCursor = await tx.objectStore("events").openCursor();
  while (evCursor) {
    const ev = evCursor.value.event;
    if (ev.kind === "message-created" && ev.authorId === userId) await evCursor.delete();
    evCursor = await evCursor.continue();
  }
  await tx.done;
}

/** Removes everything date-scoped inside [fromTs, toTs]; all-time aggregates (peers, words, emoji, domains) stay. */
export async function wipeDateRange(db: RetracedDatabase, fromTs: number, toTs: number): Promise<void> {
  const fromDate = dateKey(fromTs);
  const toDate = dateKey(toTs);
  const tx = db.transaction(["events", "messages", "searchIndex", "daily", "hourly", "voice", "sessions"], "readwrite");

  let evCursor = await tx.objectStore("events").index("ts").openCursor(IDBKeyRange.bound(fromTs, toTs));
  while (evCursor) {
    await evCursor.delete();
    evCursor = await evCursor.continue();
  }

  const searchIndex = tx.objectStore("searchIndex");
  let msgCursor = await tx.objectStore("messages").index("ts").openCursor(IDBKeyRange.bound(fromTs, toTs));
  while (msgCursor) {
    const row = msgCursor.value;
    if (row.content !== null) {
      for (const term of new Set(tokenize(row.content))) void searchIndex.delete([term, row.messageId]);
    }
    await msgCursor.delete();
    msgCursor = await msgCursor.continue();
  }

  let dailyCursor = await tx.objectStore("daily").index("date").openCursor(IDBKeyRange.bound(fromDate, toDate));
  while (dailyCursor) {
    await dailyCursor.delete();
    dailyCursor = await dailyCursor.continue();
  }
  void tx.objectStore("hourly").delete(IDBKeyRange.bound([fromDate, 0], [toDate, 23]));
  void tx.objectStore("voice").delete(IDBKeyRange.bound([fromDate, ""], [toDate, "￿"]));
  void tx.objectStore("sessions").delete(IDBKeyRange.bound(fromDate, toDate));
  await tx.done;
}
