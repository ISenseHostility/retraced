import { Bar, BarChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, type ChartTheme } from "../theme";

/**
 * Shared diverging horizontal bars: one quantity to the left of zero, its
 * counterpart to the right, one row per entity. Deliberately calm — a shared
 * baseline and symmetric treatment, not an accusation.
 */

export interface DivergingRow {
  label: string;
  left: number;
  right: number;
  /** extra line for the tooltip, e.g. "they open 80%" */
  note?: string;
}

/** Smallest "nice" number ≥ n — keeps the domain tight without odd ticks. */
function niceCeil(n: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(n, 1)));
  const mantissa = n / power;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => mantissa <= s) ?? 10;
  return step * power;
}

export function DivergingPairChart({
  data,
  leftName,
  rightName,
  leftColor,
  rightColor,
  theme,
  width,
}: {
  data: DivergingRow[];
  leftName: string;
  rightName: string;
  leftColor: string;
  rightColor: string;
  theme: ChartTheme;
  width: number;
}) {
  const rows = data.map((r) => ({ ...r, leftNeg: -r.left }));
  const height = 40 + rows.length * 30;
  const left = niceCeil(Math.max(...data.map((r) => r.left), 1));
  const right = niceCeil(Math.max(...data.map((r) => r.right), 1));

  return (
    <BarChart layout="vertical" width={width} height={height} data={rows} stackOffset="sign" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
      <XAxis
        type="number"
        domain={[-left, right]}
        ticks={[-left, 0, Math.round(right / 2), right]}
        tickFormatter={(v: number) => formatCount(Math.abs(v))}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={{ stroke: theme.ink.axis }}
        tickLine={false}
      />
      <YAxis type="category" dataKey="label" width={150} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <ReferenceLine x={0} stroke={theme.ink.axis} />
      <Tooltip
        cursor={{ fill: theme.ink.grid }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]!.payload as DivergingRow;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{row.label}</div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: leftColor }} />
                <span>{leftName}</span>
                <span className="retraced-tooltip-value">{formatCount(row.left)}</span>
              </div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: rightColor }} />
                <span>{rightName}</span>
                <span className="retraced-tooltip-value">{formatCount(row.right)}</span>
              </div>
              {row.note ? <div className="retraced-note">{row.note}</div> : null}
            </div>
          );
        }}
      />
      <Bar dataKey="leftNeg" stackId="pair" fill={leftColor} radius={[4, 0, 0, 4]} maxBarSize={16} isAnimationActive={false} />
      <Bar dataKey="right" stackId="pair" fill={rightColor} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
    </BarChart>
  );
}
