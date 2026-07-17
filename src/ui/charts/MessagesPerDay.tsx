import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import type { DayPoint } from "../data/selectors";
import { formatCount, type ChartTheme } from "../theme";
import { monthTicks, tickLabel } from "./axis";

export function MessagesPerDay({ data, theme, width }: { data: DayPoint[]; theme: ChartTheme; width: number }) {
  const ticks = monthTicks(data.map((d) => d.date));
  const spansYears = data.length > 0 && data[0]!.date.slice(0, 4) !== data[data.length - 1]!.date.slice(0, 4);

  return (
    <ComposedChart width={width} height={220} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} stroke={theme.ink.grid} />
      <XAxis
        dataKey="date"
        ticks={ticks}
        tickFormatter={(d: string) => tickLabel(d, spansYears)}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={{ stroke: theme.ink.axis }}
        tickLine={false}
        interval="preserveStartEnd"
      />
      <YAxis
        width={36}
        tickCount={4}
        allowDecimals={false}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
      />
      <Tooltip
        cursor={{ stroke: theme.ink.axis }}
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const point = payload[0]!.payload as DayPoint;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{label}</div>
              <div>{formatCount(point.sent)} messages</div>
              <div className="retraced-note">7-day average {point.avg7.toFixed(1)}</div>
            </div>
          );
        }}
      />
      <Area type="monotone" dataKey="sent" stroke={theme.series[0]} strokeWidth={1} strokeOpacity={0.55} fill={theme.series[0]} fillOpacity={0.16} isAnimationActive={false} activeDot={{ r: 3 }} />
      <Line type="monotone" dataKey="avg7" stroke={theme.ink.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
    </ComposedChart>
  );
}
