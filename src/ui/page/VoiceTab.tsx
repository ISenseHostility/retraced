import { useMemo } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { createLabelResolvers } from "../../patcher/labels";
import { dateKey, shiftDate } from "../../util/time";
import { BarRowList } from "../charts/BarRowList";
import { ChartCard, useElementWidth } from "../charts/ChartCard";
import { VoiceChordChart } from "../charts/VoiceChordChart";
import { VoiceMinutesChart } from "../charts/VoiceMinutesChart";
import { topVcChannels, voiceChord, voiceMinutesWeekly } from "../data/voicetab";
import { formatMinutes, readChartTheme } from "../theme";
import { useRollups } from "./useRollups";

export function VoiceTab({ engine, rangeDays }: { engine?: CaptureEngine; rangeDays: number | null }) {
  const theme = useMemo(readChartTheme, []);
  const labels = useMemo(createLabelResolvers, []);
  const data = useRollups(engine);
  const [width, measureRef] = useElementWidth();
  const chartWidth = Math.max(320, width - 32);

  const today = dateKey(Date.now());
  const from = rangeDays === null ? null : shiftDate(today, -(rangeDays - 1));
  const rangeVoice = useMemo(() => (from ? data.voice.filter((r) => r.date >= from) : data.voice), [data.voice, from]);

  const weekly = useMemo(() => voiceMinutesWeekly(rangeVoice), [rangeVoice]);
  const chord = useMemo(() => voiceChord(rangeVoice, data.peers), [rangeVoice, data.peers]);
  const channels = useMemo(() => topVcChannels(rangeVoice, { channelLabel: labels.channelLabel }), [rangeVoice, labels]);

  if (!data.loaded) return <p className="retraced-note">loading…</p>;

  return (
    <div ref={measureRef} className="retraced-overview">
      {data.dbMissing ? (
        <p className="retraced-banner">Capture is unavailable, so charts have nothing to read — see the Overview tab for details.</p>
      ) : null}

      <ChartCard
        title="Time in voice"
        subtitle="minutes per week in voice channels"
        empty={weekly.length === 0 ? "Join a voice channel and your minutes start counting here." : null}
        table={{ columns: ["Week", "Minutes"], rows: weekly.map((w) => [w.week, w.minutes]) }}
      >
        <VoiceMinutesChart data={weekly} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Who you share voice with"
        subtitle="shared minutes between you and your circle — hover a name to isolate them"
        empty={chord === null ? "Spend some voice time with people and the shared-minutes ring appears here." : null}
        table={
          chord
            ? {
                columns: ["Person", "Person", "Shared"],
                rows: chord.matrix.flatMap((row, i) =>
                  row
                    .map((minutes, j) => ({ minutes, j }))
                    .filter(({ minutes, j }) => j > i && minutes > 0)
                    .map(({ minutes, j }) => [chord.names[i]!, chord.names[j]!, formatMinutes(minutes)])
                ),
              }
            : null
        }
      >
        {chord ? <VoiceChordChart data={chord} theme={theme} width={chartWidth} /> : null}
      </ChartCard>

      <ChartCard
        title="Top voice channels"
        subtitle="total time per channel"
        empty={channels.length === 0 ? "Voice channels you spend time in rank themselves here." : null}
        table={{ columns: ["Channel", "Time"], rows: channels.map((c) => [c.label, formatMinutes(c.minutes)]) }}
      >
        <BarRowList
          rows={channels.map((c) => ({ key: c.channelId, label: c.label, value: c.minutes, valueLabel: formatMinutes(c.minutes) }))}
          color={theme.series[0]!}
          theme={theme}
        />
      </ChartCard>
    </div>
  );
}
