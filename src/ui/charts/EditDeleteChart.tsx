import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";
import type { ChannelRates } from "../data/hesitation";
import { formatCount, type ChartTheme } from "../theme";

/** Grouped horizontal bars: edited % and deleted % of messages sent, per channel. */
export function EditDeleteChart({ data, theme, width }: { data: ChannelRates[]; theme: ChartTheme; width: number }) {
  const height = 40 + data.length * 42;
  const edited = theme.series[6]!;
  const deleted = theme.series[7]!;

  return (
    <BarChart layout="vertical" width={width} height={height} data={data} margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barGap={2}>
      <XAxis
        type="number"
        tickFormatter={(v: number) => `${v}%`}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={{ stroke: theme.ink.axis }}
        tickLine={false}
      />
      <YAxis type="category" dataKey="label" width={150} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip
        cursor={{ fill: theme.ink.grid }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]!.payload as ChannelRates;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{row.label}</div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: edited }} />
                <span>edited</span>
                <span className="retraced-tooltip-value">{row.editPct}%</span>
              </div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: deleted }} />
                <span>deleted</span>
                <span className="retraced-tooltip-value">{row.deletePct}%</span>
              </div>
              <div className="retraced-note">of {formatCount(row.sent)} sent</div>
            </div>
          );
        }}
      />
      <Bar dataKey="editPct" fill={edited} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
      <Bar dataKey="deletePct" fill={deleted} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
    </BarChart>
  );
}
