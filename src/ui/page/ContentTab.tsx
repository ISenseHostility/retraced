import { useEffect, useMemo, useState } from "react";
import type { CaptureEngine } from "../../capture/engine";
import { getTopTerms } from "../../db/queries";
import type { MessageRow } from "../../db/schema";
import { createLabelResolvers } from "../../patcher/labels";
import { dateKey, parseDateKey, shiftDate } from "../../util/time";
import { BarRowList } from "../charts/BarRowList";
import { ChartCard, useElementWidth } from "../charts/ChartCard";
import { ContentTypeDonut } from "../charts/ContentTypeDonut";
import { LengthBandsChart } from "../charts/LengthBandsChart";
import { VocabRichnessChart } from "../charts/VocabRichnessChart";
import {
  LENGTH_BUCKET_LABELS,
  contentTypeSplit,
  emojiByServer,
  lengthShareWeekly,
  topDomains,
  vocabRichnessWeekly,
} from "../data/content";
import { colorForSlot, formatCount, readChartTheme } from "../theme";
import { SearchCard } from "./SearchCard";
import { useRollups } from "./useRollups";

interface TermRow {
  term: string;
  count: number;
}

export function ContentTab({ engine, rangeDays }: { engine?: CaptureEngine; rangeDays: number | null }) {
  const theme = useMemo(readChartTheme, []);
  const labels = useMemo(createLabelResolvers, []);
  const data = useRollups(engine);
  const [width, measureRef] = useElementWidth();
  const chartWidth = Math.max(320, width - 32);

  const today = dateKey(Date.now());
  const from = rangeDays === null ? null : shiftDate(today, -(rangeDays - 1));
  const rangeDaily = useMemo(() => (from ? data.daily.filter((r) => r.date >= from) : data.daily), [data.daily, from]);

  const split = useMemo(() => contentTypeSplit(rangeDaily), [rangeDaily]);
  const emojiGroups = useMemo(() => emojiByServer(data.emoji, { guildLabel: labels.guildLabel }), [data.emoji, labels]);
  const [emojiScope, setEmojiScope] = useState<string | null>(null);
  const emojiGroup = emojiGroups.find((g) => g.scope === emojiScope) ?? emojiGroups[0] ?? null;
  const domains = useMemo(() => topDomains(data.domains), [data.domains]);
  const vocab = useMemo(() => vocabRichnessWeekly(rangeDaily), [rangeDaily]);
  const vocabSignal = vocab.filter((w) => w.minePct !== null || w.theirsPct !== null).length;

  const [termKind, setTermKind] = useState<"word" | "phrase">("word");
  const [terms, setTerms] = useState<{ mine: TermRow[]; theirs: TermRow[] } | null>(null);
  useEffect(() => {
    const db = engine?.getDb();
    if (!db || !data.loaded) return;
    let alive = true;
    const stopWords = new Set(engine?.getSettings().stopWords ?? []);
    const skip = (term: string): boolean => {
      const parts = term.split(" ");
      return parts.every((p) => stopWords.has(p));
    };
    void Promise.all([
      getTopTerms(db, "mine", { kind: termKind, limit: 15, skip }),
      getTopTerms(db, "theirs", { kind: termKind, limit: 15, skip }),
    ]).then(([mine, theirs]) => {
      if (alive) setTerms({ mine, theirs });
    });
    return () => {
      alive = false;
    };
  }, [engine, data.loaded, termKind]);

  const [lengthSide, setLengthSide] = useState<"mine" | "theirs">("mine");
  const lengthWeeks = useMemo(() => lengthShareWeekly(rangeDaily, lengthSide), [rangeDaily, lengthSide]);

  const channelOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of data.daily) {
      totals.set(row.channelId, (totals.get(row.channelId) ?? 0) + row.sent + (row.theirSent ?? 0));
    }
    return [...totals.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([id]) => ({ id, label: labels.channelLabel(id) }));
  }, [data.daily, labels]);

  const peerNames = useMemo(() => new Map(data.peers.map((p) => [p.userId, p.label ?? p.userId])), [data.peers]);
  const authorLabel = (row: MessageRow): string => (row.isOwn ? "you" : (peerNames.get(row.authorId) ?? row.authorId));
  const fromTs = from === null ? null : parseDateKey(from).getTime();

  if (!data.loaded) return <p className="retraced-note">loading…</p>;

  const youColor = theme.series[0]!;
  const themColor = theme.series[4]!;
  const emojiUrl = (id: string): string => `https://cdn.discordapp.com/emojis/${id}.png?size=32`;

  return (
    <div ref={measureRef} className="retraced-overview">
      {data.dbMissing ? (
        <p className="retraced-banner">Capture is unavailable, so charts have nothing to read — see the Overview tab for details.</p>
      ) : null}

      <ChartCard
        title="What your messages are made of"
        subtitle="content types across your sent messages"
        legend={split.slices.map((s) => ({ label: s.label, color: colorForSlot(theme, s.colorSlot) }))}
        empty={split.total === 0 ? "Send a few messages and their content mix shows up here." : null}
        table={{
          columns: ["Type", "Messages", "Share"],
          rows: split.slices.map((s) => [s.label, s.count, `${Math.round((100 * s.count) / Math.max(1, split.total))}%`]),
        }}
      >
        <ContentTypeDonut data={split} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Top custom emoji"
        subtitle="your most-used, per server · all time"
        actions={
          emojiGroups.length > 1 ? (
            <select
              className="retraced-select"
              value={emojiGroup?.scope ?? ""}
              onChange={(e) => setEmojiScope(e.target.value)}
              aria-label="Choose a server"
            >
              {emojiGroups.map((g) => (
                <option key={g.scope} value={g.scope}>
                  {g.label}
                </option>
              ))}
            </select>
          ) : null
        }
        empty={!emojiGroup ? "Use a custom emoji (in a message or reaction) and it lands here." : null}
        table={
          emojiGroup
            ? {
                columns: ["Emoji", "Uses"],
                rows: emojiGroup.emoji.map((e) => [`:${e.name}:`, e.count]),
              }
            : null
        }
      >
        {emojiGroup ? (
          <BarRowList
            rows={emojiGroup.emoji.map((e) => ({
              key: e.emojiId,
              label: `:${e.name}:`,
              value: e.count,
              icon: (
                <img
                  className="retraced-emoji"
                  src={emojiUrl(e.emojiId)}
                  alt=""
                  loading="lazy"
                  onError={(ev) => {
                    ev.currentTarget.style.display = "none";
                  }}
                />
              ),
            }))}
            color={theme.series[3]!}
            theme={theme}
          />
        ) : null}
      </ChartCard>

      <ChartCard
        title="Top link domains"
        subtitle="links seen in captured channels · all time"
        empty={domains.length === 0 ? "Share a link (or catch one in a DM) and its domain is counted here." : null}
        table={{ columns: ["Domain", "Links"], rows: domains.map((d) => [d.domain, d.count]) }}
      >
        <BarRowList rows={domains.map((d) => ({ key: d.domain, label: d.domain, value: d.count }))} color={colorForSlot(theme, 2)} theme={theme} />
      </ChartCard>

      <ChartCard
        title="Vocabulary richness"
        subtitle="share of each week's words that were new that day · your line spans everywhere, theirs is DMs only"
        legend={[
          { label: "You — everywhere", color: youColor },
          { label: "Them — DMs only", color: themColor },
        ]}
        empty={vocabSignal < 2 ? "Needs a couple of weeks with enough words to mean anything — keep chatting." : null}
        table={{
          columns: ["Week", "You %", "Them (DMs) %"],
          rows: vocab.map((w) => [w.week, w.minePct === null ? "—" : `${w.minePct}%`, w.theirsPct === null ? "—" : `${w.theirsPct}%`]),
        }}
      >
        <VocabRichnessChart data={vocab} youColor={youColor} themColor={themColor} theme={theme} width={chartWidth} />
      </ChartCard>

      <ChartCard
        title="Most-used words"
        subtitle="you everywhere · them in DMs only · stopwords editable in plugin settings"
        actions={
          <div className="retraced-ranges" role="group" aria-label="Words or phrases">
            <button type="button" className="retraced-range-pill" aria-pressed={termKind === "word"} onClick={() => setTermKind("word")}>
              words
            </button>
            <button type="button" className="retraced-range-pill" aria-pressed={termKind === "phrase"} onClick={() => setTermKind("phrase")}>
              phrases
            </button>
          </div>
        }
        empty={terms !== null && terms.mine.length === 0 && terms.theirs.length === 0 ? "Once messages accumulate, the words you lean on show up here." : null}
        table={
          terms
            ? {
                columns: ["Yours", "Count", "Theirs (DMs)", "Count"],
                rows: Array.from({ length: Math.max(terms.mine.length, terms.theirs.length) }, (_, i) => [
                  terms.mine[i]?.term ?? "",
                  terms.mine[i]?.count ?? "",
                  terms.theirs[i]?.term ?? "",
                  terms.theirs[i]?.count ?? "",
                ]),
              }
            : null
        }
      >
        {terms ? (
          <div className="retraced-words-columns">
            <div>
              <p className="retraced-note retraced-words-head">You — everywhere</p>
              <BarRowList rows={terms.mine.map((t) => ({ key: t.term, label: t.term, value: t.count }))} color={youColor} theme={theme} />
            </div>
            <div>
              <p className="retraced-note retraced-words-head">Them — DMs only</p>
              <BarRowList rows={terms.theirs.map((t) => ({ key: t.term, label: t.term, value: t.count }))} color={themColor} theme={theme} />
            </div>
          </div>
        ) : (
          <p className="retraced-note">loading…</p>
        )}
      </ChartCard>

      <ChartCard
        title="Message length over time"
        subtitle="weekly share by length band (characters)"
        legend={LENGTH_BUCKET_LABELS.map((label, i) => ({ label, color: theme.lengthRamp[i]! }))}
        actions={
          <div className="retraced-ranges" role="group" aria-label="Whose messages">
            <button type="button" className="retraced-range-pill" aria-pressed={lengthSide === "mine"} onClick={() => setLengthSide("mine")}>
              yours
            </button>
            <button type="button" className="retraced-range-pill" aria-pressed={lengthSide === "theirs"} onClick={() => setLengthSide("theirs")}>
              theirs (DMs)
            </button>
          </div>
        }
        empty={
          lengthWeeks.length < 2
            ? "Length bands need a couple of weeks of messages — captured from Phase 6 onward."
            : null
        }
        table={{
          columns: ["Week", ...LENGTH_BUCKET_LABELS.map((l) => `${l} chars`), "Messages"],
          rows: lengthWeeks.map((w) => [w.week, ...w.shares.map((s) => `${s}%`), formatCount(w.total)]),
        }}
      >
        <LengthBandsChart data={lengthWeeks} theme={theme} width={chartWidth} />
      </ChartCard>

      <SearchCard engine={engine} fromTs={fromTs} channels={channelOptions} channelLabel={labels.channelLabel} authorLabel={authorLabel} />
    </div>
  );
}
