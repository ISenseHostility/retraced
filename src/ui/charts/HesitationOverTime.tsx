import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { WeekHesitation } from "../data/hesitation";
import { formatCount, type ChartTheme } from "../theme";
import { monthTicks, tickLabel } from "./axis";

/** The flagship metric over time: weekly share of typing runs that were abandoned. */
export function HesitationOverTime({ data, theme, width }: { data: WeekHesitation[]; theme: ChartTheme; width: number }) {
  const weeks = data.map((w) => w.week);
  const ticks = monthTicks(weeks);
  const spansYears = weeks.length > 0 && weeks[0]!.slice(0, 4) !== weeks[weeks.length - 1]!.slice(0, 4);
  const aborted = theme.series[5]!;

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
          const week = payload[0]!.payload as WeekHesitation;
          if (week.pct === null) return null;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">Week of {label}</div>
              <div>{week.pct}% abandoned</div>
              <div className="retraced-note">
                {formatCount(week.aborted)} aborted · {formatCount(week.committed)} sent
              </div>
            </div>
          );
        }}
      />
      <Line type="monotone" dataKey="pct" stroke={aborted} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 3 }} />
    </LineChart>
  );
}
