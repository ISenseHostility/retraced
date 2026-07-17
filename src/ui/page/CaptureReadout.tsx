import { useEffect, useState, useSyncExternalStore } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { runSynthetic } from "../../dev/synthetic";
import { wipeAll } from "../../db/wipe";
import { warn } from "../../env/bd";

/**
 * Phase 2's "raw counter readout": live capture status and store sizes.
 * Charts replace most of this from Phase 3 — the dev tools stay.
 */
export function CaptureReadout({ engine }: { engine: CaptureEngine }) {
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const [rows, setRows] = useState<Record<string, number> | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async (): Promise<void> => {
      const [rowCounts, estimate] = await Promise.all([engine.getRowCounts(), engine.getStorageEstimate()]);
      if (alive) {
        setRows(rowCounts);
        setStorage(estimate);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [engine]);

  const s = snap.session;
  const counters: Array<[string, number]> = [
    ["messages", s.byKind["message-created"] ?? 0],
    ["edits", s.byKind["message-edited"] ?? 0],
    ["deletes", s.byKind["message-deleted"] ?? 0],
    ["typing resolved", s.byKind["typing-resolved"] ?? 0],
    ["reactions", s.byKind["reaction"] ?? 0],
    ["dwell segments", s.byKind["dwell"] ?? 0],
    ["voice segments", s.byKind["voice-segment"] ?? 0],
    ["dropped", s.dropped],
  ];

  const runDevSynthetic = async (days: number): Promise<void> => {
    const db = engine.getDb();
    if (!db || busy) return;
    setBusy(`generating ${days}d…`);
    try {
      await runSynthetic(db, { days, seed: Date.now() % 100_000, onProgress: (n) => setBusy(`generating… ${n} events`) });
    } catch (e) {
      warn("synthetic generation failed", e);
    } finally {
      setBusy(null);
    }
  };

  const runWipe = async (): Promise<void> => {
    const db = engine.getDb();
    if (!db || busy) return;
    if (typeof confirm === "function" && !confirm("Retraced: wipe ALL captured data? This cannot be undone.")) return;
    setBusy("wiping…");
    try {
      await wipeAll(db);
    } catch (e) {
      warn("wipe failed", e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="retraced-readout">
      <h3>
        Capture <span className={`retraced-status retraced-status--${snap.status}`}>{snap.status}</span>
      </h3>
      {snap.statusDetail ? <p className="retraced-note">{snap.statusDetail}</p> : null}

      <div className="retraced-counter-grid">
        {counters.map(([label, value]) => (
          <div key={label} className="retraced-counter">
            <span className="retraced-counter-value">{value}</span>
            <span className="retraced-note">{label}</span>
          </div>
        ))}
      </div>

      <p className="retraced-note">
        session events: {s.total} · buffered: {s.buffered} · flushed: {s.flushedEvents} in {s.flushes} flushes
        {s.lastFlushTs ? ` · last flush ${Math.max(0, Math.round((Date.now() - s.lastFlushTs) / 1000))}s ago` : ""}
        {s.openTypingSessions > 0 ? ` · typing now in ${s.openTypingSessions} channel(s)` : ""}
      </p>

      {rows ? (
        <p className="retraced-note">
          stored rows — {Object.entries(rows).map(([store, count]) => `${store}: ${count}`).join(" · ")}
        </p>
      ) : null}
      {storage ? (
        <p className="retraced-note">storage used: {(storage.usage / 1_048_576).toFixed(1)} MiB of {(storage.quota / 1_073_741_824).toFixed(1)} GiB quota</p>
      ) : null}

      <details className="retraced-devtools">
        <summary className="retraced-note">dev tools</summary>
        <div className="retraced-devtools-row">
          <button type="button" className="retraced-button" disabled={busy !== null} onClick={() => void runDevSynthetic(365)}>
            Generate 1y synthetic data
          </button>
          <button type="button" className="retraced-button" disabled={busy !== null} onClick={() => void runDevSynthetic(90)}>
            Generate 90d
          </button>
          <button type="button" className="retraced-button retraced-button--danger" disabled={busy !== null} onClick={() => void runWipe()}>
            Wipe all data
          </button>
          {busy ? <span className="retraced-note">{busy}</span> : null}
        </div>
        <p className="retraced-note">Synthetic data exercises the real capture pipeline so charts can be developed before a week of real usage exists.</p>
      </details>
    </section>
  );
}
