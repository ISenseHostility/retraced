import { useMemo } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { dateKey, shiftDate } from "../../util/time";
import { ChartCard, useElementWidth } from "../charts/ChartCard";
import { DayHourHeatmap } from "../charts/DayHourHeatmap";
import { NightOwlLine } from "../charts/NightOwlLine";
import { RadialClock } from "../charts/RadialClock";
import { SessionLengths } from "../charts/SessionLengths";
import { SESSION_BUCKET_LABELS, dayHourGrid, hourOfDayProfile, nightOwlByMonth, sessionHistogram } from "../data/rhythm";
import { readChartTheme } from "../theme";
import { useRollups } from "./useRollups";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

export function RhythmTab({ engine, rangeDays }: { engine?: CaptureEngine; rangeDays: number | null }) {
  const theme = useMemo(readChartTheme, []);
  const data = useRollups(engine);
  const [width, measureRef] = useElementWidth();
  const chartWidth = Math.max(320, width - 32);

  const today = dateKey(Date.now());
  const from = rangeDays === null ? null : shiftDate(today, -(rangeDays - 1));

  const rangeHourly = useMemo(() => (from ? data.hourly.filter((r) => r.date >= from) : data.hourly), [data.hourly, from]);
  const rangeSessions = useMemo(() => (from ? data.sessions.filter((r) => r.date >= from) : data.sessions), [data.sessions, from]);

  const profile = useMemo(() => hourOfDayProfile(rangeHourly), [rangeHourly]);
  const grid = useMemo(() => dayHourGrid(rangeHourly), [rangeHourly]);
  const nightPoints = useMemo(() => nightOwlByMonth(rangeHourly), [rangeHourly]);
  const sessions = useMemo(() => sessionHistogram(rangeSessions), [rangeSessions]);
  const monthsWithSignal = nightPoints.filter((p) => p.pct !== null).length;

  if (!data.loaded) return <p className="retraced-note">loading…</p>;

  return (
    <div ref={measureRef} className="retraced-overview">
      {data.dbMissing ? (
        <p className="retraced-banner">Capture is unavailable, so charts have nothing to read — see the Overview tab for details.</p>
      ) : null}

      <ChartCard
        title="Around the clock"
        subtitle="your messages by hour of day · the 22:00–06:00 night sector is shaded"
        empty={profile.total === 0 ? "A day or two of chatting will draw your daily shape here." : null}
        table={{
          columns: ["Hour", "Messages"],
          rows: profile.hours.map((count, h) => [hh(h), count]),
        }}
      >
        <RadialClock data={profile} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Your week, hour by hour"
        subtitle="messages by weekday and hour"
        empty={grid.total === 0 ? "Once messages span a few days, your weekly pattern shows up here." : null}
        table={{
          columns: ["Day", ...Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"))],
          rows: grid.grid.map((row, i) => [DAYS[i]!, ...row]),
        }}
      >
        <DayHourHeatmap data={grid} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Night owl by month"
        subtitle="share of messages sent between 22:00 and 06:00"
        empty={monthsWithSignal < 2 ? "This line needs at least two months with real activity — check back later." : null}
        table={{
          columns: ["Month", "Night %", "Messages"],
          rows: nightPoints.map((p) => [p.month, p.pct === null ? "—" : `${p.pct}%`, p.total]),
        }}
      >
        <NightOwlLine data={nightPoints} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Session lengths"
        subtitle={`runs of messaging without a 30-minute break${
          sessions.medianBucket !== null ? ` · median ${SESSION_BUCKET_LABELS[sessions.medianBucket]}` : ""
        }`}
        empty={sessions.total === 0 ? "Sessions appear once a break separates two runs of messages — keep chatting." : null}
        table={{
          columns: ["Length", "Sessions"],
          rows: sessions.buckets.map((count, i) => [SESSION_BUCKET_LABELS[i]!, count]),
        }}
      >
        <SessionLengths data={sessions} theme={theme} width={chartWidth} />
      </ChartCard>
    </div>
  );
}
