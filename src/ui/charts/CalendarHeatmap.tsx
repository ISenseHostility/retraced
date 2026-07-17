import { useState } from "react";
import { dateKey, mondayOf, parseDateKey, shiftDate } from "../../util/time";
import type { CalendarYear } from "../data/selectors";
import { formatCount, type ChartTheme } from "../theme";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface HoverState {
  x: number;
  y: number;
  date: string;
  count: number;
}

/** GitHub-style calendar, one row per year, hand-rolled SVG. */
export function CalendarHeatmap({ years, theme }: { years: CalendarYear[]; theme: ChartTheme }) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const today = dateKey(Date.now());

  return (
    <div className="retraced-calendar" style={{ position: "relative" }}>
      {years.map((year) => (
        <YearGrid key={year.year} year={year} theme={theme} today={today} onHover={setHover} />
      ))}
      <div className="retraced-legend retraced-calendar-legend">
        <span className="retraced-note">less</span>
        <svg width={5 * STEP} height={CELL} role="presentation">
          {[theme.calendarZero, ...theme.calendarBins].map((fill, i) => (
            <rect key={i} x={i * STEP} width={CELL} height={CELL} rx={2.5} fill={fill} />
          ))}
        </svg>
        <span className="retraced-note">more</span>
      </div>
      {hover ? (
        <div className="retraced-tooltip retraced-tooltip--floating" style={{ left: hover.x, top: hover.y }}>
          <div className="retraced-tooltip-title">{hover.date}</div>
          <div>{hover.count === 0 ? "no messages" : `${formatCount(hover.count)} messages`}</div>
        </div>
      ) : null}
    </div>
  );
}

function YearGrid({
  year,
  theme,
  today,
  onHover,
}: {
  year: CalendarYear;
  theme: ChartTheme;
  today: string;
  onHover: (h: HoverState | null) => void;
}) {
  const jan1 = `${year.year}-01-01`;
  const dec31 = `${year.year}-12-31`;
  const gridStart = mondayOf(jan1);
  const counts = new Map(year.days.map((d) => [d.date, d]));

  const cells: Array<{ date: string; column: number; row: number; fill: string; count: number }> = [];
  let cursor = gridStart;
  for (let i = 0; i < 371; i++) {
    if (cursor > dec31 || cursor > today) break;
    if (cursor >= jan1) {
      const day = counts.get(cursor);
      cells.push({
        date: cursor,
        column: Math.floor(i / 7),
        row: i % 7,
        count: day?.count ?? 0,
        fill: day && day.level > 0 ? theme.calendarBins[day.level - 1]! : theme.calendarZero,
      });
    }
    cursor = shiftDate(cursor, 1);
  }

  const columns = (cells[cells.length - 1]?.column ?? 0) + 1;
  const monthLabels: Array<{ column: number; label: string }> = [];
  for (let month = 0; month < 12; month++) {
    const first = `${year.year}-${String(month + 1).padStart(2, "0")}-01`;
    if (first > today) break;
    const dayIndex = Math.round((parseDateKey(first).getTime() - parseDateKey(gridStart).getTime()) / 86_400_000);
    const column = Math.floor(dayIndex / 7);
    if (column >= 0 && column < columns) monthLabels.push({ column, label: MONTHS[month]! });
  }

  const left = 34;
  const top = 18;
  const width = left + columns * STEP;
  const height = top + 7 * STEP;

  return (
    <div className="retraced-calendar-year">
      <svg width={width} height={height} role="img" aria-label={`Activity calendar ${year.year}`}>
        <text x={0} y={top + 8} className="retraced-svg-label" fill={theme.ink.muted} fontWeight={600}>
          {year.year}
        </text>
        {monthLabels.map((m) => (
          <text key={m.label} x={left + m.column * STEP} y={11} className="retraced-svg-label" fill={theme.ink.muted}>
            {m.label}
          </text>
        ))}
        {cells.map((cell) => (
          <rect
            key={cell.date}
            x={left + cell.column * STEP}
            y={top + cell.row * STEP}
            width={CELL}
            height={CELL}
            rx={2.5}
            fill={cell.fill}
            onMouseEnter={(e) => {
              const host = (e.currentTarget.ownerSVGElement?.parentElement?.parentElement ?? null) as HTMLElement | null;
              const hostRect = host?.getBoundingClientRect();
              const rect = e.currentTarget.getBoundingClientRect();
              onHover({
                x: rect.left - (hostRect?.left ?? 0) + CELL / 2,
                y: rect.top - (hostRect?.top ?? 0) - 8,
                date: cell.date,
                count: cell.count,
              });
            }}
            onMouseLeave={() => onHover(null)}
          >
            <title>{`${cell.date} — ${cell.count} messages`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
