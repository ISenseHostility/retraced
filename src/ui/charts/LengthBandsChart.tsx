import { Area, AreaChart, Tooltip, XAxis, YAxis } from "recharts";
import { LENGTH_BUCKET_LABELS, type LengthWeek } from "../data/content";
import { type ChartTheme } from "../theme";
import { monthTicks, tickLabel } from "./axis";

/**
 * Message-length distribution over time: weekly 100% stacked bands on the
 * validated ordinal ramp — short messages at the bottom, essays on top.
 */
export function LengthBandsChart({ data, theme, width }: { data: LengthWeek[]; theme: ChartTheme; width: number }) {
  const rows = data.map((w) => {
    const row: Record<string, number | string> = { week: w.week, total: w.total };
    w.shares.forEach((share, i) => (row[`b${i}`] = share));
    return row;
  });
  const weeks = data.map((w) => w.week);
  const ticks = monthTicks(weeks);
  const spansYears = weeks.length > 0 && weeks[0]!.slice(0, 4) !== weeks[weeks.length - 1]!.slice(0, 4);

  return (
    <AreaChart width={width} height={240} data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
        ticks={[0, 25, 50, 75, 100]}
        tickFormatter={(v: number) => `${v}%`}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        domain={[0, 100]}
      />
      <Tooltip
        cursor={{ stroke: theme.ink.axis }}
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]!.payload as Record<string, number>;
          if (!row.total) return null;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">Week of {label}</div>
              {LENGTH_BUCKET_LABELS.map((bandLabel, i) => (
                <div key={bandLabel} className="retraced-tooltip-row">
                  <span className="retraced-legend-dot" style={{ background: theme.lengthRamp[i] }} />
                  <span>{bandLabel} chars</span>
                  <span className="retraced-tooltip-value">{row[`b${i}`]}%</span>
                </div>
              ))}
            </div>
          );
        }}
      />
      {LENGTH_BUCKET_LABELS.map((_, i) => (
        <Area
          key={i}
          dataKey={`b${i}`}
          stackId="length"
          type="monotone"
          fill={theme.lengthRamp[i]}
          fillOpacity={1}
          stroke={theme.ink.card}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      ))}
    </AreaChart>
  );
}
