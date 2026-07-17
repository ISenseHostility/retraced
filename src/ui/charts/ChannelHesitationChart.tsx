import { Bar, BarChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { ChannelTyping } from "../data/hesitation";
import { formatCount, type ChartTheme } from "../theme";

/**
 * Diverging horizontal bars: aborted typing to the left, committed to the
 * right, per channel. Calm by construction — both sides share a baseline.
 */
/** Smallest "nice" number ≥ n — keeps the diverging domain tight without odd ticks. */
function niceCeil(n: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(n, 1)));
  const mantissa = n / power;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => mantissa <= s) ?? 10;
  return step * power;
}

export function ChannelHesitationChart({ data, theme, width }: { data: ChannelTyping[]; theme: ChartTheme; width: number }) {
  const rows = data.map((c) => ({ ...c, abortedNeg: -c.aborted }));
  const height = 40 + rows.length * 30;
  const aborted = theme.series[5]!;
  const committed = theme.series[0]!;
  // tight, hand-rolled domain: auto-padding would turn the (small) aborted side into invisible slivers
  const left = niceCeil(Math.max(...data.map((c) => c.aborted), 1));
  const right = niceCeil(Math.max(...data.map((c) => c.committed), 1));

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
          const row = payload[0]!.payload as ChannelTyping;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{row.label}</div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: aborted }} />
                <span>aborted</span>
                <span className="retraced-tooltip-value">{formatCount(row.aborted)}</span>
              </div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: committed }} />
                <span>committed</span>
                <span className="retraced-tooltip-value">{formatCount(row.committed)}</span>
              </div>
              <div className="retraced-note">hesitation {row.pct}%</div>
            </div>
          );
        }}
      />
      <Bar dataKey="abortedNeg" stackId="typing" fill={aborted} radius={[4, 0, 0, 4]} maxBarSize={16} isAnimationActive={false} />
      <Bar dataKey="committed" stackId="typing" fill={committed} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
    </BarChart>
  );
}
