// @vitest-environment node
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test } from "vitest";
import { getAllPeers, getAllVoice, getDailyRange, getHourlyRange } from "../src/db/queries";
import { openRetracedDb, type DailyRow, type RetracedDatabase } from "../src/db/schema";

let db: RetracedDatabase;

const daily = (date: string, channelId: string, sent: number): DailyRow => ({
  date,
  channelId,
  guildId: "g1",
  sent,
  edited: 0,
  deleted: 0,
  chars: 0,
  words: 0,
  uniqueWords: 0,
  typingCommitted: 0,
  typingAborted: 0,
  typingMs: 0,
  dwellMs: 0,
  reactionsGiven: 0,
  reactionsReceived: 0,
  contentTypes: { text: 0, image: 0, link: 0, gif: 0, sticker: 0, attachment: 0 },
  initiatedByMe: 0,
  initiatedByThem: 0,
  deleteAfterBuckets: [0, 0, 0, 0, 0, 0, 0],
  longestBurst: 0,
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db = await openRetracedDb();
  const tx = db.transaction(["daily", "hourly", "peers"], "readwrite");
  for (const row of [daily("2026-07-01", "a", 1), daily("2026-07-02", "a", 2), daily("2026-07-02", "b", 3), daily("2026-07-05", "a", 4)]) {
    void tx.objectStore("daily").put(row);
  }
  void tx.objectStore("hourly").put({ date: "2026-07-01", hour: 3, sent: 5 });
  void tx.objectStore("hourly").put({ date: "2026-07-03", hour: 23, sent: 7 });
  await tx.done;
});

describe("read queries", () => {
  test("getDailyRange is inclusive on both bounds", async () => {
    const rows = await getDailyRange(db, "2026-07-02", "2026-07-05");
    expect(rows.map((r) => [r.date, r.channelId])).toEqual([
      ["2026-07-02", "a"],
      ["2026-07-02", "b"],
      ["2026-07-05", "a"],
    ]);
  });

  test("getDailyRange with null from returns everything", async () => {
    expect(await getDailyRange(db, null, "2026-07-31")).toHaveLength(4);
  });

  test("getHourlyRange bounds by date", async () => {
    const rows = await getHourlyRange(db, "2026-07-02", "2026-07-04");
    expect(rows).toEqual([{ date: "2026-07-03", hour: 23, sent: 7 }]);
    expect(await getHourlyRange(db, null, "2026-07-31")).toHaveLength(2);
  });

  test("getAllPeers returns the store contents", async () => {
    expect(await getAllPeers(db)).toEqual([]);
  });

  test("getAllVoice returns the store contents", async () => {
    await db.put("voice", { date: "2026-07-01", channelId: "vc1", guildId: "g1", seconds: 60, coPresent: { "200": 60 } });
    expect(await getAllVoice(db)).toHaveLength(1);
  });
});
