import type { SummaryStats } from "../data/selectors";
import { formatCount } from "../theme";

interface Card {
  key: string;
  label: string;
  value: string;
  detail: string;
}

/** The six spec cards. Definitions live with the data, phrasing lives here. */
export function SummaryCards({ stats }: { stats: SummaryStats }) {
  const cards: Card[] = [
    {
      key: "night-owl",
      label: "Night owl",
      value: stats.nightOwlPct === null ? "—" : `${stats.nightOwlPct}%`,
      detail: "of messages sent 22:00–06:00",
    },
    {
      key: "streak",
      label: "Active streak",
      value: `${stats.currentStreakDays}`,
      detail: stats.currentStreakDays === 1 ? "day in a row" : "days in a row",
    },
    {
      key: "burst",
      label: "Longest burst",
      value: stats.longestBurst > 0 ? formatCount(stats.longestBurst) : "—",
      detail: "messages in one conversation",
    },
    {
      key: "most-messaged",
      label: "Most messaged",
      value: stats.mostMessaged?.label ?? "—",
      detail: stats.mostMessaged ? `${formatCount(stats.mostMessaged.total)} messages, all time` : "no DM traffic yet",
    },
    {
      key: "ghost",
      label: "Ghost rate",
      value: stats.ghostRatePct === null ? "—" : `${stats.ghostRatePct}%`,
      detail: "DM days with their opener, no reply",
    },
    {
      key: "hesitation",
      label: "Hesitation index",
      value: stats.hesitation === null ? "—" : `${stats.hesitation.pct}%`,
      detail: stats.hesitation
        ? `${formatCount(stats.hesitation.aborted)} abandoned of ${formatCount(stats.hesitation.aborted + stats.hesitation.committed)} typed`
        : "starts counting as you type",
    },
  ];

  return (
    <div className="retraced-cards">
      {cards.map((card) => (
        <div key={card.key} className="retraced-card">
          <span className="retraced-card-label">{card.label}</span>
          <span className="retraced-card-value" title={card.value.length > 14 ? card.value : undefined}>
            {card.value}
          </span>
          <span className="retraced-note">{card.detail}</span>
        </div>
      ))}
    </div>
  );
}
