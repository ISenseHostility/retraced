import { useMemo, useState } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { ChartCard, useElementWidth } from "../charts/ChartCard";
import { DivergingPairChart } from "../charts/DivergingPairChart";
import { ForceGraph } from "../charts/ForceGraph";
import { LatencyDistributionChart } from "../charts/LatencyDistributionChart";
import { ReplyMedianChart } from "../charts/ReplyMedianChart";
import {
  REPLY_BUCKET_LABELS,
  initiatorRatio,
  latencyDistribution,
  reactionBalance,
  replyMedians,
  socialGraph,
} from "../data/people";
import { formatCount, readChartTheme } from "../theme";
import { useRollups } from "./useRollups";

export function PeopleTab({ engine }: { engine?: CaptureEngine; rangeDays: number | null }) {
  const theme = useMemo(readChartTheme, []);
  const data = useRollups(engine);
  const [width, measureRef] = useElementWidth();
  const chartWidth = Math.max(320, width - 32);

  const [initiatorSort, setInitiatorSort] = useState<"total" | "them" | "me">("total");
  const [replySort, setReplySort] = useState<"them" | "me">("them");
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(10);

  const youColor = theme.series[0]!;
  const themColor = theme.series[4]!;

  const initiators = useMemo(() => initiatorRatio(data.peers, { sortBy: initiatorSort }), [data.peers, initiatorSort]);
  const medians = useMemo(() => {
    const rows = replyMedians(data.peers);
    // nulls sink to the bottom; slowest first — the emotionally honest default
    const key = (b: number | null): number => (b === null ? -1 : b);
    rows.sort(
      replySort === "them"
        ? (a, b) => key(b.theirsBucket) - key(a.theirsBucket)
        : (a, b) => key(b.mineBucket) - key(a.mineBucket)
    );
    return rows;
  }, [data.peers, replySort]);

  const latencyPeers = useMemo(
    () =>
      data.peers
        .filter((p) => p.latencyBucketsMine.some((n) => n > 0) || p.latencyBucketsTheirs.some((n) => n > 0))
        .sort((a, b) => b.msgToThem + b.msgFromThem - (a.msgToThem + a.msgFromThem))
        .slice(0, 25),
    [data.peers]
  );
  const selected = latencyPeers.find((p) => p.userId === selectedPeer) ?? latencyPeers[0] ?? null;
  const distribution = useMemo(() => (selected ? latencyDistribution(selected) : null), [selected]);

  const maxVolume = useMemo(() => Math.max(...data.peers.map((p) => p.msgToThem + p.msgFromThem), 10), [data.peers]);
  const graph = useMemo(() => socialGraph(data.peers, data.voice, { threshold }), [data.peers, data.voice, threshold]);
  const reactions = useMemo(() => reactionBalance(data.peers), [data.peers]);

  if (!data.loaded) return <p className="retraced-note">loading…</p>;

  const pairLegend = [
    { label: "You", color: youColor },
    { label: "Them", color: themColor },
  ];

  return (
    <div ref={measureRef} className="retraced-overview">
      {data.dbMissing ? (
        <p className="retraced-banner">Capture is unavailable, so charts have nothing to read — see the Overview tab for details.</p>
      ) : null}
      <p className="retraced-note">The People tab reads all-time per-person rollups, so the time-range filter doesn't apply here.</p>

      <ChartCard
        title="Who reaches out first"
        subtitle="conversation openers in each DM · all time"
        legend={pairLegend}
        actions={
          <div className="retraced-ranges" role="group" aria-label="Sort people">
            <button type="button" className="retraced-range-pill" aria-pressed={initiatorSort === "total"} onClick={() => setInitiatorSort("total")}>
              most talked
            </button>
            <button type="button" className="retraced-range-pill" aria-pressed={initiatorSort === "them"} onClick={() => setInitiatorSort("them")}>
              they start
            </button>
            <button type="button" className="retraced-range-pill" aria-pressed={initiatorSort === "me"} onClick={() => setInitiatorSort("me")}>
              you start
            </button>
          </div>
        }
        empty={initiators.length === 0 ? "Once a few DM conversations have opened, who opened them shows up here." : null}
        table={{
          columns: ["Person", "You opened", "They opened", "Their share"],
          rows: initiators.map((r) => [r.label, r.mine, r.theirs, `${r.theirSharePct}%`]),
        }}
      >
        <DivergingPairChart
          data={initiators.map((r) => ({ label: r.label, left: r.mine, right: r.theirs, note: `they open ${r.theirSharePct}% of conversations` }))}
          leftName="you opened"
          rightName="they opened"
          leftColor={youColor}
          rightColor={themColor}
          theme={theme}
          width={chartWidth}
        />
      </ChartCard>

      <ChartCard
        title="Reply speed"
        subtitle="median time to reply, per person · all time"
        legend={pairLegend}
        actions={
          <div className="retraced-ranges" role="group" aria-label="Sort by pace">
            <button type="button" className="retraced-range-pill" aria-pressed={replySort === "them"} onClick={() => setReplySort("them")}>
              their pace
            </button>
            <button type="button" className="retraced-range-pill" aria-pressed={replySort === "me"} onClick={() => setReplySort("me")}>
              your pace
            </button>
          </div>
        }
        empty={medians.length === 0 ? "Reply speeds appear after a handful of back-and-forth exchanges with someone." : null}
        table={{
          columns: ["Person", "Your median", "Their median", "Your replies", "Their replies"],
          rows: medians.map((r) => [
            r.label,
            r.mineBucket === null ? "—" : REPLY_BUCKET_LABELS[r.mineBucket]!,
            r.theirsBucket === null ? "—" : REPLY_BUCKET_LABELS[r.theirsBucket]!,
            r.mineCount,
            r.theirsCount,
          ]),
        }}
      >
        <ReplyMedianChart data={medians} youColor={youColor} themColor={themColor} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title={`Reply latency with ${selected ? (selected.label ?? selected.userId) : "…"}`}
        subtitle="how reply gaps distribute, both directions · all time"
        legend={pairLegend}
        actions={
          latencyPeers.length > 1 ? (
            <select
              className="retraced-select"
              aria-label="Choose a person"
              value={selected?.userId ?? ""}
              onChange={(e) => setSelectedPeer(e.target.value)}
            >
              {latencyPeers.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.label ?? p.userId}
                </option>
              ))}
            </select>
          ) : null
        }
        empty={!distribution ? "Pick up a conversation and the reply-gap distribution appears here." : null}
        table={
          distribution
            ? {
                columns: ["Gap", "Your replies", "Their replies"],
                rows: distribution.map((r) => [r.label, r.mine, r.theirs]),
              }
            : null
        }
      >
        {distribution ? (
          <LatencyDistributionChart data={distribution} youColor={youColor} themColor={themColor} theme={theme} width={chartWidth} />
        ) : null}
      </ChartCard>

      <ChartCard
        title="Your circle"
        subtitle="people sized by messages · teal links share voice time with you · all time"
        actions={
          <label className="retraced-slider">
            <span className="retraced-note">at least {threshold} messages</span>
            <input
              type="range"
              min={1}
              max={Math.max(20, Math.min(200, maxVolume))}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
        }
        empty={graph.nodes.length <= 1 ? "The graph appears once a few people cross the message threshold — try lowering it." : null}
        table={{
          columns: ["Person", "Messages"],
          rows: graph.nodes.filter((n) => !n.isYou).map((n) => [n.label, formatCount(n.volume)]),
        }}
      >
        <ForceGraph data={graph} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Reactions, given and received"
        subtitle="emoji reactions between you and each person · all time"
        legend={[
          { label: "You gave", color: youColor },
          { label: "They gave", color: themColor },
        ]}
        empty={reactions.length === 0 ? "React to someone (or earn a reaction) and the exchange shows up here." : null}
        table={{
          columns: ["Person", "You gave", "They gave"],
          rows: reactions.map((r) => [r.label, r.given, r.received]),
        }}
      >
        <DivergingPairChart
          data={reactions.map((r) => ({ label: r.label, left: r.given, right: r.received }))}
          leftName="you gave"
          rightName="they gave"
          leftColor={youColor}
          rightColor={themColor}
          theme={theme}
          width={chartWidth}
        />
      </ChartCard>
    </div>
  );
}
