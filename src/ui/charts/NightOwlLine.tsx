import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthNightPoint } from "../data/rhythm";
import { formatCount, type ChartTheme } from "../theme";
import { tickLabel } from "./axis";

export function NightOwlLine({ data, theme, width }: { data: MonthNightPoint[]; theme: ChartTheme; width: number }) {
  const months = data.map((p) => p.month);
  const ticks = months.length > 13 ? months.filter((_, i) => i % 2 === 0) : months;
  const spansYears = months.length > 0 && months[0]!.slice(0, 4) !== months[months.length - 1]!.slice(0, 4);

  return (
    <LineChart width={width} height={220} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} stroke={theme.ink.grid} />
      <XAxis
        dataKey="month"
        ticks={ticks}
        tickFormatter={(m: string) => tickLabel(`${m}-01`, spansYears)}
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
          const point = payload[0]!.payload as MonthNightPoint;
          if (point.pct === null) return null;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{label}</div>
              <div>{point.pct}% at night</div>
              <div className="retraced-note">{formatCount(point.total)} messages that month</div>
            </div>
          );
        }}
      />
      <Line type="monotone" dataKey="pct" stroke={theme.series[0]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} activeDot={{ r: 3 }} />
    </LineChart>
  );
}
