import { useEffect, useRef, useState, type ReactNode } from "react";

export interface LegendItem {
  label: string;
  color: string;
}

export interface TableView {
  columns: string[];
  rows: Array<Array<string | number>>;
}

/**
 * Shared chart shell: title, legend pills, an accessible data-table toggle
 * (the relief obligation for low-contrast series), and the empty state.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  empty,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table?: TableView | null;
  empty?: string | null;
  /** extra header controls (e.g. a sort toggle) — hidden in the empty state */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="retraced-chart-card">
      <header className="retraced-chart-head">
        <div>
          <h3 className="retraced-chart-title">{title}</h3>
          {subtitle ? <p className="retraced-note">{subtitle}</p> : null}
        </div>
        <div className="retraced-card-actions">
          {!empty ? actions : null}
          {!empty && table ? (
            <button type="button" className="retraced-ghost-button" onClick={() => setShowTable((v) => !v)}>
              {showTable ? "Chart" : "Data"}
            </button>
          ) : null}
        </div>
      </header>
      {!empty && legend && legend.length > 1 ? (
        <div className="retraced-legend">
          {legend.map((item) => (
            <span key={item.label} className="retraced-legend-pill">
              <span className="retraced-legend-dot" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
      {empty ? (
        <div className="retraced-empty">
          <span className="retraced-empty-title">Not enough data yet</span>
          <span className="retraced-note">{empty}</span>
        </div>
      ) : showTable && table ? (
        <div className="retraced-table-wrap">
          <table className="retraced-table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

/** Width of the card body — ResizeObserver where available, a sane fixed fallback elsewhere (tests). */
export function useElementWidth(fallback = 760): [number, (el: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(fallback);
  const observerRef = useRef<ResizeObserver | null>(null);

  const attach = (el: HTMLDivElement | null): void => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 80) setWidth(Math.floor(w));
    });
    observer.observe(el);
    observerRef.current = observer;
  };

  useEffect(() => () => observerRef.current?.disconnect(), []);
  return [width, attach];
}
