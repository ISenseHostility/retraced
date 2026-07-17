import { arc as d3arc, curveCatmullRomClosed, lineRadial } from "d3-shape";
import { useState } from "react";
import type { HourProfile } from "../data/rhythm";
import { formatCompact, formatCount, type ChartTheme } from "../theme";

/**
 * 24-spoke polar area chart of hour-of-day activity (spec §5 Rhythm: "not a
 * bar chart"). Midnight sits at the top; the 22:00–06:00 night sector is
 * shaded so the shape reads against the tab's night-owl storyline.
 */

const TAU = Math.PI * 2;
const hh = (h: number): string => `${String((h + 24) % 24).padStart(2, "0")}:00`;

export function RadialClock({ data, theme, width }: { data: HourProfile; theme: ChartTheme; width: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const height = 320;
  const cx = width / 2;
  const cy = 160;
  const maxR = 118;
  const max = Math.max(...data.hours, 1);
  const r = (v: number): number => (v / max) * maxR;
  const angle = (h: number): number => (h / 24) * TAU;
  const point = (h: number, radius: number): [number, number] => [cx + Math.sin(angle(h)) * radius, cy - Math.cos(angle(h)) * radius];

  const shape =
    lineRadial<number>()
      .angle((_, i) => angle(i))
      .radius((v) => r(v))
      .curve(curveCatmullRomClosed)(data.hours) ?? "";

  const arcGen = d3arc();
  const nightPath = arcGen({ innerRadius: 0, outerRadius: maxR, startAngle: angle(22), endAngle: angle(30) }) ?? "";
  const wedge = (h: number): string => arcGen({ innerRadius: 0, outerRadius: maxR + 6, startAngle: angle(h - 0.5), endAngle: angle(h + 0.5) }) ?? "";

  const peak = data.peakHour;
  const peakPoint = peak !== null ? point(peak, r(data.hours[peak]!)) : null;
  const peakOnLeft = peak !== null && peak > 12;

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={height} role="img" aria-label="Messages by hour of day">
        {/* night sector — barely-there, same token as the calendar's zero cells */}
        <path d={nightPath} transform={`translate(${cx},${cy})`} fill={theme.calendarZero} />

        {/* grid: solid hairline rings + a spoke per quarter */}
        {[1 / 3, 2 / 3, 1].map((f) => (
          <circle key={f} cx={cx} cy={cy} r={maxR * f} fill="none" stroke={theme.ink.grid} />
        ))}
        {[0, 6, 12, 18].map((h) => {
          const [x, y] = point(h, maxR);
          return <line key={h} x1={cx} y1={cy} x2={x} y2={y} stroke={theme.ink.grid} />;
        })}

        {/* ring values, selectively: just the outer ring */}
        <text x={cx + 5} y={cy - maxR + 11} className="retraced-svg-label" fill={theme.ink.muted}>
          {formatCompact(max)}
        </text>

        {/* the data shape */}
        <path d={shape} transform={`translate(${cx},${cy})`} fill={theme.series[0]} fillOpacity={0.22} stroke={theme.series[0]} strokeWidth={2} strokeLinejoin="round" />

        {/* hour labels at the quarters */}
        <text x={cx} y={cy - maxR - 8} textAnchor="middle" className="retraced-svg-label" fill={theme.ink.muted}>
          00
        </text>
        <text x={cx + maxR + 14} y={cy + 3} textAnchor="middle" className="retraced-svg-label" fill={theme.ink.muted}>
          06
        </text>
        <text x={cx} y={cy + maxR + 14} textAnchor="middle" className="retraced-svg-label" fill={theme.ink.muted}>
          12
        </text>
        <text x={cx - maxR - 14} y={cy + 3} textAnchor="middle" className="retraced-svg-label" fill={theme.ink.muted}>
          18
        </text>

        {/* peak, direct-labeled — the one number the chart is about */}
        {peak !== null && peakPoint ? (
          <g>
            <circle cx={peakPoint[0]} cy={peakPoint[1]} r={4} fill={theme.series[0]} stroke={theme.ink.card} strokeWidth={2} />
            <text
              x={peakPoint[0] + (peakOnLeft ? -8 : 8)}
              y={peakPoint[1] - 6}
              textAnchor={peakOnLeft ? "end" : "start"}
              className="retraced-svg-label"
              fill={theme.ink.primary}
              fontWeight={600}
            >
              {`${hh(peak)} · ${formatCompact(data.hours[peak]!)}`}
            </text>
          </g>
        ) : null}

        {/* hover wedges — generous hit areas over the whole dial */}
        {data.hours.map((count, h) => (
          <path
            key={h}
            d={wedge(h)}
            transform={`translate(${cx},${cy})`}
            fill={hover === h ? theme.ink.grid : "transparent"}
            onMouseEnter={() => setHover(h)}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${hh(h)}–${hh(h + 1)} — ${formatCount(count)} messages`}</title>
          </path>
        ))}
      </svg>
      {hover !== null ? (
        <div
          className="retraced-tooltip retraced-tooltip--floating"
          style={{ left: point(hover, maxR * 0.72)[0], top: point(hover, maxR * 0.72)[1] - 10 }}
        >
          <div className="retraced-tooltip-title">{`${hh(hover)}–${hh(hover + 1)}`}</div>
          <div>{formatCount(data.hours[hover]!)} messages</div>
        </div>
      ) : null}
    </div>
  );
}
