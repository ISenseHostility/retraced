import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CaptureEngine, EngineSnapshot } from "../../capture/engine";
import { getAllDomains, getAllEmoji, getAllPeers, getAllVoice, getDailyRange, getHourlyRange, getSessionRange } from "../../db/queries";
import type { DailyRow, DomainRow, EmojiRow, HourlyRow, PeerRow, SessionRow, VoiceRow } from "../../db/schema";
import { dateKey } from "../../util/time";

/**
 * The one data hook behind every tab: loads all-time rollups once and
 * refetches when the engine's status or flush count changes. Tabs slice
 * by range in memory — rollup stores are small by design.
 */

export interface RollupData {
  daily: DailyRow[];
  hourly: HourlyRow[];
  peers: PeerRow[];
  sessions: SessionRow[];
  voice: VoiceRow[];
  emoji: EmojiRow[];
  domains: DomainRow[];
  loaded: boolean;
  dbMissing: boolean;
}

const EMPTY_SNAPSHOT: EngineSnapshot = {
  status: "idle",
  statusDetail: null,
  session: { byKind: {}, total: 0, buffered: 0, flushedEvents: 0, flushes: 0, dropped: 0, openTypingSessions: 0, lastFlushTs: null },
};

export function useRollups(engine: CaptureEngine | undefined): RollupData {
  const subscribe = useMemo(() => engine?.subscribe ?? (() => () => undefined), [engine]);
  const getSnapshot = useMemo(() => engine?.getSnapshot ?? (() => EMPTY_SNAPSHOT), [engine]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const [data, setData] = useState<RollupData>({
    daily: [],
    hourly: [],
    peers: [],
    sessions: [],
    voice: [],
    emoji: [],
    domains: [],
    loaded: false,
    dbMissing: false,
  });

  useEffect(() => {
    let alive = true;
    const db = engine?.getDb();
    if (!db) {
      setData((d) => ({ ...d, loaded: true, dbMissing: true }));
      return;
    }
    void (async () => {
      const today = dateKey(Date.now());
      const [daily, hourly, peers, sessions, voice, emoji, domains] = await Promise.all([
        getDailyRange(db, null, today),
        getHourlyRange(db, null, today),
        getAllPeers(db),
        getSessionRange(db, null, today),
        getAllVoice(db),
        getAllEmoji(db),
        getAllDomains(db),
      ]);
      if (alive) setData({ daily, hourly, peers, sessions, voice, emoji, domains, loaded: true, dbMissing: false });
    })().catch(() => {
      if (alive) setData((d) => ({ ...d, loaded: true }));
    });
    return () => {
      alive = false;
    };
  }, [engine, snapshot.status, snapshot.session.flushes]);

  return data;
}
