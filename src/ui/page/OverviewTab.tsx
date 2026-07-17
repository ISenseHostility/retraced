import { useMemo } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { createLabelResolvers } from "../../patcher/labels";
import { dateKey, shiftDate } from "../../util/time";
import { CalendarHeatmap } from "../charts/CalendarHeatmap";
import { ChartCard, useElementWidth } from "../charts/ChartCard";
import { MessagesPerDay } from "../charts/MessagesPerDay";
import { SankeyFlow } from "../charts/SankeyFlow";
import { ServerStreamgraph } from "../charts/ServerStreamgraph";
import { SummaryCards } from "../charts/SummaryCards";
import {
  calendarByYear,
  guildSlotOrder,
  messagesPerDaySeries,
  sankeyFlows,
  serverShareWeekly,
  summaryStats,
} from "../data/selectors";
import { colorForSlot, formatCount, readChartTheme } from "../theme";
import { CaptureReadout } from "./CaptureReadout";
import { useRollups } from "./useRollups";

export function OverviewTab({ engine, rangeDays }: { engine?: CaptureEngine; rangeDays: number | null }) {
  const theme = useMemo(readChartTheme, []);
  const labels = useMemo(createLabelResolvers, []);
  const data = useRollups(engine);
  const [width, measureRef] = useElementWidth();
  const chartWidth = Math.max(320, width - 32);

  const today = dateKey(Date.now());
  const from = rangeDays === null ? null : shiftDate(today, -(rangeDays - 1));

  const rangeDaily = useMemo(() => (from ? data.daily.filter((r) => r.date >= from) : data.daily), [data.daily, from]);
  const rangeHourly = useMemo(() => (from ? data.hourly.filter((r) => r.date >= from) : data.hourly), [data.hourly, from]);

  const stats = useMemo(
    () => summaryStats({ daily: rangeDaily, hourly: rangeHourly, peers: data.peers, streakDaily: data.daily, today }),
    [rangeDaily, rangeHourly, data.peers, data.daily, today]
  );
  const seriesFrom = from ?? rangeDaily.reduce((min, r) => (r.date < min ? r.date : min), today);
  const daySeries = useMemo(() => messagesPerDaySeries(rangeDaily, seriesFrom, today), [rangeDaily, seriesFrom, today]);
  // color follows the entity: slots come from the all-time ordering, not the range's
  const slotOrder = useMemo(() => guildSlotOrder(data.daily), [data.daily]);
  const slotFor = (guildId: string): number => slotOrder.get(guildId) ?? -1;
  const stream = useMemo(
    () => serverShareWeekly(rangeDaily, { guildLabel: labels.guildLabel, slotFor }),
    [rangeDaily, labels, slotOrder]
  );
  const sankeyData = useMemo(
    () => sankeyFlows(rangeDaily, { guildLabel: labels.guildLabel, channelLabel: labels.channelLabel, slotFor }),
    [rangeDaily, labels, slotOrder]
  );
  const calendar = useMemo(() => calendarByYear(data.daily), [data.daily]);

  if (!data.loaded) return <p className="retraced-note">loading…</p>;

  return (
    <div ref={measureRef} className="retraced-overview">
      {data.dbMissing ? (
        <p className="retraced-banner">Capture is unavailable, so charts have nothing to read — details in the capture card below.</p>
      ) : null}

      <ChartCard
        title="Where your messages go"
        subtitle={`you → servers → channels · ${formatCount(stats.totalSent)} messages in range`}
        empty={sankeyData === null ? "Send a few messages and they will flow here — you → servers → channels." : null}
        table={
          sankeyData
            ? {
                columns: ["From", "To", "Messages"],
                rows: sankeyData.links.map((l) => [
                  sankeyData.nodes.find((n) => n.id === l.source)?.label ?? l.source,
                  sankeyData.nodes.find((n) => n.id === l.target)?.label ?? l.target,
                  formatCount(l.value),
                ]),
              }
            : null
        }
      >
        {sankeyData ? <SankeyFlow data={sankeyData} theme={theme} width={chartWidth} /> : null}
      </ChartCard>

      <SummaryCards stats={stats} />

      <ChartCard
        title="Messages per day"
        subtitle="your sent messages, with a 7-day average"
        legend={[
          { label: "Sent", color: theme.series[0]! },
          { label: "7-day average", color: theme.ink.primary },
        ]}
        empty={stats.totalSent === 0 ? "No messages in this range yet — try a wider range, or just go chat." : null}
        table={{
          columns: ["Date", "Messages", "7-day avg"],
          rows: daySeries.map((p) => [p.date, p.sent, p.avg7.toFixed(1)]),
        }}
      >
        <MessagesPerDay data={daySeries} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Server share over time"
        subtitle="weekly message volume, by where it went"
        legend={stream.series.map((s) => ({ label: s.label, color: colorForSlot(theme, s.colorSlot) }))}
        empty={stream.weeks.length < 2 ? "Needs at least two weeks of activity to draw the flow — check back soon." : null}
        table={{
          columns: ["Week", ...stream.series.map((s) => s.label)],
          rows: stream.weeks.map((w) => [w.week as string, ...stream.series.map((s) => w[s.key] as number)]),
        }}
      >
        <ServerStreamgraph data={stream} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Activity calendar"
        subtitle="every day, all time"
        empty={calendar.length === 0 ? "A year view builds up day by day — check back after a few days of chatting." : null}
        table={
          calendar.length > 0
            ? {
                columns: ["Date", "Messages"],
                rows: calendar.flatMap((y) => y.days.map((d) => [d.date, d.count] as Array<string | number>)),
              }
            : null
        }
      >
        <CalendarHeatmap years={calendar} theme={theme} />
      </ChartCard>

      {engine ? <CaptureReadout engine={engine} /> : null}
    </div>
  );
}
