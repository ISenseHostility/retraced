import { useMemo, useState } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { createLabelResolvers } from "../../patcher/labels";
import { dateKey, shiftDate } from "../../util/time";
import { ChannelHesitationChart } from "../charts/ChannelHesitationChart";
import { ChartCard, useElementWidth } from "../charts/ChartCard";
import { DeleteLifetimeChart } from "../charts/DeleteLifetimeChart";
import { EditDeleteChart } from "../charts/EditDeleteChart";
import { HesitationOverTime } from "../charts/HesitationOverTime";
import { PeerHesitationChart } from "../charts/PeerHesitationChart";
import {
  DELETE_BUCKET_LABELS,
  channelHesitation,
  deleteLifetime,
  editDeleteRates,
  hesitationWeekly,
  peerHesitation,
} from "../data/hesitation";
import { formatCount, readChartTheme } from "../theme";
import { useRollups } from "./useRollups";

export function HesitationTab({ engine, rangeDays }: { engine?: CaptureEngine; rangeDays: number | null }) {
  const theme = useMemo(readChartTheme, []);
  const labels = useMemo(createLabelResolvers, []);
  const data = useRollups(engine);
  const [width, measureRef] = useElementWidth();
  const chartWidth = Math.max(320, width - 32);
  const [sortBy, setSortBy] = useState<"volume" | "rate">("volume");

  const today = dateKey(Date.now());
  const from = rangeDays === null ? null : shiftDate(today, -(rangeDays - 1));
  const rangeDaily = useMemo(() => (from ? data.daily.filter((r) => r.date >= from) : data.daily), [data.daily, from]);

  const weekly = useMemo(() => hesitationWeekly(rangeDaily), [rangeDaily]);
  const weeksWithSignal = weekly.filter((w) => w.pct !== null).length;
  const channels = useMemo(
    () => channelHesitation(rangeDaily, { channelLabel: labels.channelLabel, guildLabel: labels.guildLabel, sortBy }),
    [rangeDaily, labels, sortBy]
  );
  const peers = useMemo(() => peerHesitation(data.peers), [data.peers]);
  const rates = useMemo(
    () => editDeleteRates(rangeDaily, { channelLabel: labels.channelLabel, guildLabel: labels.guildLabel }),
    [rangeDaily, labels]
  );
  const lifetime = useMemo(() => deleteLifetime(rangeDaily), [rangeDaily]);

  const abortedColor = theme.series[5]!;
  const committedColor = theme.series[0]!;

  if (!data.loaded) return <p className="retraced-note">loading…</p>;

  return (
    <div ref={measureRef} className="retraced-overview">
      {data.dbMissing ? (
        <p className="retraced-banner">Capture is unavailable, so charts have nothing to read — see the Overview tab for details.</p>
      ) : null}

      <ChartCard
        title="Hesitation over time"
        subtitle="weekly share of typing runs you abandoned before sending"
        empty={weeksWithSignal < 2 ? "This line needs a couple of weeks of typing history — it fills in as you chat." : null}
        table={{
          columns: ["Week", "Abandoned %", "Aborted", "Committed"],
          rows: weekly.map((w) => [w.week, w.pct === null ? "—" : `${w.pct}%`, w.aborted, w.committed]),
        }}
      >
        <HesitationOverTime data={weekly} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Where you hesitate"
        subtitle="abandoned vs sent typing runs, per channel"
        legend={[
          { label: "Aborted", color: abortedColor },
          { label: "Committed", color: committedColor },
        ]}
        actions={
          <div className="retraced-ranges" role="group" aria-label="Sort channels">
            <button type="button" className="retraced-range-pill" aria-pressed={sortBy === "volume"} onClick={() => setSortBy("volume")}>
              most typing
            </button>
            <button type="button" className="retraced-range-pill" aria-pressed={sortBy === "rate"} onClick={() => setSortBy("rate")}>
              most hesitant
            </button>
          </div>
        }
        empty={channels.length === 0 ? "No channel has enough typing history yet — this needs a handful of typing runs per channel." : null}
        table={{
          columns: ["Channel", "Aborted", "Committed", "Hesitation %"],
          rows: channels.map((c) => [c.label, c.aborted, c.committed, `${c.pct}%`]),
        }}
      >
        <ChannelHesitationChart data={channels} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Who makes you hesitate"
        subtitle="typing runs abandoned in DMs, per person · all time"
        empty={peers.length === 0 ? "Nothing here yet — abandoned typing in a DM shows up against that person." : null}
        table={{
          columns: ["Person", "Abandoned runs"],
          rows: peers.map((p) => [p.label, p.aborted]),
        }}
      >
        <PeerHesitationChart data={peers} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Edits and deletions"
        subtitle="share of your sent messages you later edited or deleted, per channel"
        legend={[
          { label: "Edited", color: theme.series[6]! },
          { label: "Deleted", color: theme.series[7]! },
        ]}
        empty={rates.length === 0 ? "Rates appear once a channel has at least 20 of your messages." : null}
        table={{
          columns: ["Channel", "Sent", "Edited %", "Deleted %"],
          rows: rates.map((c) => [c.label, c.sent, `${c.editPct}%`, `${c.deletePct}%`]),
        }}
      >
        <EditDeleteChart data={rates} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Time to delete"
        subtitle="how long your deleted messages lived"
        empty={lifetime.total === 0 ? "No deletions captured yet — a deleted message records how long it survived." : null}
        table={{
          columns: ["Lifetime", "Deletions"],
          rows: lifetime.buckets.map((count, i) => [DELETE_BUCKET_LABELS[i]!, count]),
        }}
      >
        <div className="retraced-hero-block">
          <span className="retraced-hero-figure">{lifetime.medianBucket !== null ? DELETE_BUCKET_LABELS[lifetime.medianBucket] : "—"}</span>
          <span className="retraced-note">median lifetime · {formatCount(lifetime.total)} deletions</span>
        </div>
        <DeleteLifetimeChart data={lifetime} theme={theme} width={chartWidth} />
      </ChartCard>
    </div>
  );
}
