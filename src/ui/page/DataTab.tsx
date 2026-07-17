import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { exportAll, importAll, type ExportEnvelope } from "../../db/export";
import { getStoreStats, type StoreStats } from "../../db/queries";
import { rebuildContentIndex, rebuildFromEvents } from "../../db/rebuild";
import { wipeAll, wipeContentOnly, wipeDateRange, wipePeer } from "../../db/wipe";
import { parseDateKey } from "../../util/time";
import { formatCount } from "../theme";
import { useRollups } from "./useRollups";

/**
 * The Data tab: backup, storage truth, removal, repair. DM content is real
 * personal data about real people — none of this is an afterthought (spec §1.2).
 */

const DAY_MS = 86_400_000;

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)} kB`;
  return `${n} B`;
}

interface PendingAction {
  description: string;
  run: () => Promise<string>;
}

export function DataTab({ engine }: { engine?: CaptureEngine; rangeDays: number | null }) {
  const data = useRollups(engine);
  const db = engine?.getDb() ?? null;

  const [stats, setStats] = useState<StoreStats[] | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [lastExportTs, setLastExportTs] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const [peerId, setPeerId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    void getStoreStats(db).then((s) => alive && setStats(s));
    void engine?.getStorageEstimate().then((e) => alive && setUsage(e));
    void db.get("meta", "lastExportTs").then((ts) => alive && setLastExportTs(typeof ts === "number" ? ts : null));
    return () => {
      alive = false;
    };
  }, [db, engine, reload]);

  const runAction = useCallback(
    (label: string, action: () => Promise<string>): void => {
      setBusy(label);
      setStatus(null);
      setPending(null);
      void action()
        .then((message) => setStatus(message))
        .catch((e) => setStatus(`${label} failed: ${String((e as Error)?.message ?? e)}`))
        .finally(() => {
          setBusy(null);
          setReload((n) => n + 1);
        });
    },
    []
  );

  const doExport = (): void => {
    if (!db) return;
    runAction("export", async () => {
      const envelope = await exportAll(db);
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `retraced-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await db.put("meta", Date.now(), "lastExportTs");
      const rows = Object.values(envelope.stores).reduce((n, r) => n + r.length, 0);
      return `Exported ${formatCount(rows)} rows.`;
    });
  };

  const onImportFile = (file: File | undefined): void => {
    if (!db || !file) return;
    void file
      .text()
      .then((text) => {
        const envelope = JSON.parse(text) as ExportEnvelope;
        if (envelope?.format !== "retraced-export") throw new Error("that file is not a Retraced backup");
        const rows = Object.values(envelope.stores ?? {}).reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0);
        setPending({
          description: `Replace everything with the backup from ${new Date(envelope.exportedAt).toLocaleDateString()} (${formatCount(rows)} rows)? Current data is erased first.`,
          run: async () => {
            const result = await importAll(db, envelope);
            return `Imported ${formatCount(result.rows)} rows.`;
          },
        });
      })
      .catch((e) => setStatus(`Import failed: ${String((e as Error)?.message ?? e)}`));
  };

  const peers = useMemo(
    () => [...data.peers].sort((a, b) => (a.label ?? a.userId).localeCompare(b.label ?? b.userId)),
    [data.peers]
  );
  const totalBytes = stats?.reduce((n, s) => n + s.approxBytes, 0) ?? 0;
  const exportAge = lastExportTs === null ? null : Math.floor((Date.now() - lastExportTs) / DAY_MS);
  const exportStale = exportAge === null || exportAge > 30;
  const disabled = !db || busy !== null;

  return (
    <div className="retraced-overview">
      {!db ? <p className="retraced-banner">The database is unavailable, so there is nothing to manage here.</p> : null}
      {status ? <p className="retraced-banner retraced-banner--info">{status}</p> : null}
      {pending ? (
        <div className="retraced-banner retraced-confirm">
          <span>{pending.description}</span>
          <span className="retraced-confirm-buttons">
            <button type="button" className="retraced-button retraced-button--danger" onClick={() => runAction("confirm", pending.run)}>
              Yes, do it
            </button>
            <button type="button" className="retraced-ghost-button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </span>
        </div>
      ) : null}

      <section className="retraced-chart-card">
        <header className="retraced-chart-head">
          <div>
            <h3 className="retraced-chart-title">Keep a copy</h3>
            <p className="retraced-note">
              Everything lives in Discord's browser storage on this device — a reinstall or cache clear can erase it without warning.
            </p>
          </div>
        </header>
        <div className="retraced-devtools-row">
          <button type="button" className="retraced-button" disabled={disabled} onClick={doExport}>
            Export backup
          </button>
          <button type="button" className="retraced-ghost-button" disabled={disabled} onClick={() => fileRef.current?.click()}>
            Import backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              onImportFile(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <span className={exportStale ? "retraced-note retraced-note--nudge" : "retraced-note"}>
            {exportAge === null ? "never exported yet" : exportAge === 0 ? "last export: today" : `last export: ${exportAge} days ago`}
          </span>
        </div>
      </section>

      <section className="retraced-chart-card">
        <header className="retraced-chart-head">
          <div>
            <h3 className="retraced-chart-title">Storage</h3>
            <p className="retraced-note">
              rows and estimated size per store
              {usage ? ` · browser reports ${formatBytes(usage.usage)} used of ${formatBytes(usage.quota)}` : ""}
            </p>
          </div>
        </header>
        {stats ? (
          <div className="retraced-table-wrap">
            <table className="retraced-table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Rows</th>
                  <th>~Size</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td>{formatCount(s.rows)}</td>
                    <td>{formatBytes(s.approxBytes)}</td>
                  </tr>
                ))}
                <tr>
                  <td>total (logical)</td>
                  <td />
                  <td>{formatBytes(totalBytes)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="retraced-note">loading…</p>
        )}
      </section>

      <section className="retraced-chart-card">
        <header className="retraced-chart-head">
          <div>
            <h3 className="retraced-chart-title">Remove data</h3>
            <p className="retraced-note">every removal asks once, then acts — there is no undo beyond your backups</p>
          </div>
        </header>
        <div className="retraced-devtools-row">
          <button
            type="button"
            className="retraced-ghost-button"
            disabled={disabled}
            onClick={() =>
              setPending({
                description: "Erase message text everywhere (messages, search, word lists)? Counts and every chart except the content ones survive.",
                run: async () => {
                  await wipeContentOnly(db!);
                  return "Stored text erased. Rollups kept.";
                },
              })
            }
          >
            Content only
          </button>
          <button
            type="button"
            className="retraced-ghost-button retraced-ghost-button--danger"
            disabled={disabled}
            onClick={() =>
              setPending({
                description: "Erase EVERYTHING Retraced has stored — statistics included? This is the full reset.",
                run: async () => {
                  await wipeAll(db!);
                  return "Everything erased.";
                },
              })
            }
          >
            Wipe everything
          </button>
        </div>
        <div className="retraced-devtools-row">
          <select className="retraced-select" value={peerId} onChange={(e) => setPeerId(e.target.value)} aria-label="Person to remove" disabled={disabled}>
            <option value="">remove a person…</option>
            {peers.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.label ?? p.userId}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="retraced-ghost-button"
            disabled={disabled || peerId === ""}
            onClick={() => {
              const peer = peers.find((p) => p.userId === peerId);
              setPending({
                description: `Remove ${peer?.label ?? peerId} — their profile row, their messages, and their search entries?`,
                run: async () => {
                  await wipePeer(db!, peerId);
                  setPeerId("");
                  return "Person removed.";
                },
              });
            }}
          >
            Remove person
          </button>
        </div>
        <div className="retraced-devtools-row">
          <input type="date" className="retraced-input retraced-input--date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" disabled={disabled} />
          <span className="retraced-note">to</span>
          <input type="date" className="retraced-input retraced-input--date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" disabled={disabled} />
          <button
            type="button"
            className="retraced-ghost-button"
            disabled={disabled || fromDate === "" || toDate === "" || fromDate > toDate}
            onClick={() =>
              setPending({
                description: `Erase everything dated ${fromDate} through ${toDate} — messages, statistics, voice, sessions? All-time totals (people, words, emoji) stay.`,
                run: async () => {
                  await wipeDateRange(db!, parseDateKey(fromDate).getTime(), parseDateKey(toDate).getTime() + DAY_MS - 1);
                  return `Erased ${fromDate} – ${toDate}.`;
                },
              })
            }
          >
            Remove range
          </button>
        </div>
      </section>

      <section className="retraced-chart-card">
        <header className="retraced-chart-head">
          <div>
            <h3 className="retraced-chart-title">Repair</h3>
            <p className="retraced-note">for when something looks wrong — both are safe to run any time</p>
          </div>
        </header>
        <div className="retraced-devtools-row">
          <button
            type="button"
            className="retraced-ghost-button"
            disabled={disabled}
            onClick={() =>
              runAction("rebuild statistics", async () => {
                const result = await rebuildFromEvents(db!, {
                  conversationGapMinutes: engine?.getSettings().conversationGapMinutes ?? 30,
                });
                return `Recomputed daily statistics from ${formatCount(result.events)} logged events.`;
              })
            }
          >
            Rebuild recent statistics
          </button>
          <span className="retraced-note">replays the raw event log (last {engine?.getSettings().eventRetentionDays ?? 30} days) through the pipeline</span>
        </div>
        <div className="retraced-devtools-row">
          <button
            type="button"
            className="retraced-ghost-button"
            disabled={disabled}
            onClick={() =>
              runAction("rebuild search", async () => {
                const result = await rebuildContentIndex(db!);
                return `Search index rebuilt from ${formatCount(result.messages)} stored messages.`;
              })
            }
          >
            Rebuild search index
          </button>
          <span className="retraced-note">re-reads every stored message — also backfills search for history captured before the index existed</span>
        </div>
        {busy ? <p className="retraced-note">working: {busy}…</p> : null}
      </section>
    </div>
  );
}
