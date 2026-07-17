import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { VoiceWeek } from "../data/voicetab";
import { formatMinutes, type ChartTheme } from "../theme";
import { monthTicks, tickLabel } from "./axis";

export function VoiceMinutesChart({ data, theme, width }: { data: VoiceWeek[]; theme: ChartTheme; width: number }) {
  const weeks = data.map((w) => w.week);
  const ticks = monthTicks(weeks);
  const spansYears = weeks.length > 0 && weeks[0]!.slice(0, 4) !== weeks[weeks.length - 1]!.slice(0, 4);

  return (
    <AreaChart width={width} height={220} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
      <YAxis width={40} tickCount={4} allowDecimals={false} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip
        cursor={{ stroke: theme.ink.axis }}
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const week = payload[0]!.payload as VoiceWeek;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">Week of {label}</div>
              <div>{formatMinutes(week.minutes)} in voice</div>
            </div>
          );
        }}
      />
      <Area type="monotone" dataKey="minutes" stroke={theme.series[0]} strokeWidth={2} fill={theme.series[0]} fillOpacity={0.16} isAnimationActive={false} activeDot={{ r: 3 }} />
    </AreaChart>
  );
}
