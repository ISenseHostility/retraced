import type { ReactNode } from "react";
import { formatCount, type ChartTheme } from "../theme";

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** shown right-aligned; defaults to the formatted value */
  valueLabel?: string;
  /** optional leading node (e.g. an emoji image) */
  icon?: ReactNode;
}

/**
 * Ranked list with proportional bars and direct value labels — for top-N
 * views (domains, emoji, VC channels) where an axis would be ceremony.
 */
export function BarRowList({ rows, color, theme }: { rows: BarRow[]; color: string; theme: ChartTheme }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="retraced-barlist" role="list">
      {rows.map((row) => (
        <div key={row.key} className="retraced-barlist-row" role="listitem">
          <span className="retraced-barlist-label" title={row.label}>
            {row.icon}
            <span className="retraced-barlist-text">{row.label}</span>
          </span>
          <span className="retraced-barlist-track">
            <span className="retraced-barlist-bar" style={{ width: `${Math.max(2, (100 * row.value) / max)}%`, background: color }} />
          </span>
          <span className="retraced-barlist-value" style={{ color: theme.ink.primary }}>
            {row.valueLabel ?? formatCount(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
