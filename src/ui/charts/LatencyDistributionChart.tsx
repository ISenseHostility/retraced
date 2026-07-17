import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { LatencyDistRow } from "../data/people";
import { formatCount, type ChartTheme } from "../theme";

/** Reply-gap distribution for one person, yours and theirs side by side. */
export function LatencyDistributionChart({
  data,
  youColor,
  themColor,
  theme,
  width,
}: {
  data: LatencyDistRow[];
  youColor: string;
  themColor: string;
  theme: ChartTheme;
  width: number;
}) {
  return (
    <BarChart width={width} height={220} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
      <CartesianGrid vertical={false} stroke={theme.ink.grid} />
      <XAxis dataKey="label" tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={{ stroke: theme.ink.axis }} tickLine={false} interval={0} />
      <YAxis width={36} tickCount={4} allowDecimals={false} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip
        cursor={{ fill: theme.ink.grid }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]!.payload as LatencyDistRow;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{row.label}</div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: youColor }} />
                <span>your replies</span>
                <span className="retraced-tooltip-value">{formatCount(row.mine)}</span>
              </div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: themColor }} />
                <span>their replies</span>
                <span className="retraced-tooltip-value">{formatCount(row.theirs)}</span>
              </div>
            </div>
          );
        }}
      />
      <Bar dataKey="mine" fill={youColor} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      <Bar dataKey="theirs" fill={themColor} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
    </BarChart>
  );
}
