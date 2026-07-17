import { useState } from "react";
import type { DayHourGrid } from "../data/rhythm";
import { formatCount, type ChartTheme } from "../theme";

/** 7×24 weekday-by-hour heatmap, hand-rolled SVG, Monday first. */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GAP = 2;

interface HoverState {
  x: number;
  y: number;
  label: string;
  count: number;
}

export function DayHourHeatmap({ data, theme, width }: { data: DayHourGrid; theme: ChartTheme; width: number }) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const left = 36;
  const top = 4;
  const bottom = 18;
  const step = Math.max(10, Math.min(32, Math.floor((width - left) / 24)));
  const cell = step - GAP;
  const svgWidth = left + 24 * step;
  const svgHeight = top + 7 * step + bottom;

  // quartile bins pooled over active cells, same treatment as the calendar
  const nonzero = data.grid.flat().filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f: number): number => nonzero[Math.floor(f * (nonzero.length - 1))] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const fillFor = (v: number): string => {
    if (v <= 0) return theme.calendarZero;
    const level = v <= q1 ? 0 : v <= q2 ? 1 : v <= q3 ? 2 : 3;
    return theme.calendarBins[level]!;
  };

  return (
    <div style={{ position: "relative", overflowX: "auto" }}>
      <svg width={svgWidth} height={svgHeight} role="img" aria-label="Messages by weekday and hour">
        {DAYS.map((day, row) => (
          <text key={day} x={0} y={top + row * step + cell / 2 + 3.5} className="retraced-svg-label" fill={theme.ink.muted}>
            {day}
          </text>
        ))}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={left + h * step} y={top + 7 * step + 12} className="retraced-svg-label" fill={theme.ink.muted}>
            {String(h).padStart(2, "0")}
          </text>
        ))}
        {data.grid.map((rowValues, row) =>
          rowValues.map((count, h) => (
            <rect
              key={`${row}-${h}`}
              x={left + h * step}
              y={top + row * step}
              width={cell}
              height={cell}
              rx={2.5}
              fill={fillFor(count)}
              onMouseEnter={(e) => {
                const host = e.currentTarget.ownerSVGElement?.parentElement ?? null;
                const hostRect = host?.getBoundingClientRect();
                const rect = e.currentTarget.getBoundingClientRect();
                setHover({
                  x: rect.left - (hostRect?.left ?? 0) + cell / 2,
                  y: rect.top - (hostRect?.top ?? 0) - 8,
                  label: `${DAYS[row]} ${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`,
                  count,
                });
              }}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${DAYS[row]} ${String(h).padStart(2, "0")}:00 — ${count} messages`}</title>
            </rect>
          ))
        )}
      </svg>
      <div className="retraced-legend retraced-calendar-legend">
        <span className="retraced-note">less</span>
        <svg width={5 * (cell + GAP)} height={cell} role="presentation">
          {[theme.calendarZero, ...theme.calendarBins].map((fill, i) => (
            <rect key={i} x={i * (cell + GAP)} width={cell} height={cell} rx={2.5} fill={fill} />
          ))}
        </svg>
        <span className="retraced-note">more</span>
      </div>
      {hover ? (
        <div className="retraced-tooltip retraced-tooltip--floating" style={{ left: hover.x, top: hover.y }}>
          <div className="retraced-tooltip-title">{hover.label}</div>
          <div>{hover.count === 0 ? "no messages" : `${formatCount(hover.count)} messages`}</div>
        </div>
      ) : null}
    </div>
  );
}
