import { Area, AreaChart, Tooltip, XAxis } from "recharts";
import type { StreamResult } from "../data/selectors";
import { colorForSlot, formatCount, type ChartTheme } from "../theme";
import { monthTicks, tickLabel } from "./axis";

/**
 * The signature chart: a streamgraph of where your messages live, week by
 * week. Bands are separated by surface-colored strokes (the mandated fill
 * gap, doubling as CVD-safe secondary encoding).
 */
export function ServerStreamgraph({ data, theme, width }: { data: StreamResult; theme: ChartTheme; width: number }) {
  const weeks = data.weeks.map((w) => w.week as string);
  const ticks = monthTicks(weeks);
  const spansYears = weeks.length > 0 && weeks[0]!.slice(0, 4) !== weeks[weeks.length - 1]!.slice(0, 4);

  return (
    <AreaChart width={width} height={280} data={data.weeks} stackOffset="wiggle" margin={{ top: 16, right: 8, bottom: 4, left: 8 }}>
      <XAxis
        dataKey="week"
        ticks={ticks}
        tickFormatter={(d: string) => tickLabel(d, spansYears)}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={{ stroke: theme.ink.axis }}
        tickLine={false}
        interval="preserveStartEnd"
      />
      <Tooltip
        cursor={{ stroke: theme.ink.axis }}
        content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const items = payload
            .filter((p) => typeof p.value === "number" && p.value > 0)
            .sort((a, b) => (b.value as number) - (a.value as number));
          if (items.length === 0) return null;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">Week of {label}</div>
              {items.map((item) => {
                const key = String(item.dataKey);
                return (
                  <div key={key} className="retraced-tooltip-row">
                    <span className="retraced-legend-dot" style={{ background: item.color }} />
                    <span>{data.series.find((s) => s.key === key)?.label ?? key}</span>
                    <span className="retraced-tooltip-value">{formatCount(item.value as number)}</span>
                  </div>
                );
              })}
            </div>
          );
        }}
      />
      {data.series.map((series) => (
        <Area
          key={series.key}
          type="basis"
          dataKey={series.key}
          stackId="share"
          fill={colorForSlot(theme, series.colorSlot)}
          fillOpacity={0.9}
          stroke={theme.ink.card}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      ))}
    </AreaChart>
  );
}
