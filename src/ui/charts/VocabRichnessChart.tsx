import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { VocabWeek } from "../data/content";
import { type ChartTheme } from "../theme";
import { monthTicks, tickLabel } from "./axis";

/** Weekly share of words that were new that day — the two content-rule scopes as separate, labeled lines. */
export function VocabRichnessChart({
  data,
  youColor,
  themColor,
  theme,
  width,
}: {
  data: VocabWeek[];
  youColor: string;
  themColor: string;
  theme: ChartTheme;
  width: number;
}) {
  const weeks = data.map((w) => w.week);
  const ticks = monthTicks(weeks);
  const spansYears = weeks.length > 0 && weeks[0]!.slice(0, 4) !== weeks[weeks.length - 1]!.slice(0, 4);

  return (
    <LineChart width={width} height={220} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} stroke={theme.ink.grid} />
      <XAxis
        dataKey="week"
        ticks={ticks}
        tickFormatter={(d: string) => tickLabel(d, spansYears)}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={{ stroke: theme.ink.axis }}
        tickLine={false}
        interval="preserveStartEnd"
      />
      <YAxis
        width={40}
        tickCount={4}
        allowDecimals={false}
        tickFormatter={(v: number) => `${v}%`}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip
        cursor={{ stroke: theme.ink.axis }}
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const week = payload[0]!.payload as VocabWeek;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">Week of {label}</div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: youColor }} />
                <span>you</span>
                <span className="retraced-tooltip-value">{week.minePct === null ? "—" : `${week.minePct}%`}</span>
              </div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: themColor }} />
                <span>them (DMs)</span>
                <span className="retraced-tooltip-value">{week.theirsPct === null ? "—" : `${week.theirsPct}%`}</span>
              </div>
            </div>
          );
        }}
      />
      <Line type="monotone" dataKey="minePct" stroke={youColor} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 3 }} />
      <Line type="monotone" dataKey="theirsPct" stroke={themColor} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 3 }} />
    </LineChart>
  );
}
