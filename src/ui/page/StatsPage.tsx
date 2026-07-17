import { useState } from "react";
import meta from "../../../plugin.meta.json";
import type { CaptureEngine } from "../../capture/engine";
import { ContentTab } from "./ContentTab";
import { DataTab } from "./DataTab";
import { HesitationTab } from "./HesitationTab";
import { OverviewTab } from "./OverviewTab";
import { PeopleTab } from "./PeopleTab";
import { RhythmTab } from "./RhythmTab";
import { VoiceTab } from "./VoiceTab";

const TABS = [
  ["overview", "Overview"],
  ["rhythm", "Rhythm"],
  ["hesitation", "Hesitation"],
  ["people", "People"],
  ["content", "Content"],
  ["voice", "Voice"],
  ["data", "Data"],
] as const;

type TabId = (typeof TABS)[number][0];

const RANGES: Array<{ label: string; days: number | null }> = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
  { label: "All", days: null },
];

export function StatsPage({
  variant,
  onClose,
  engine,
}: {
  variant: "overlay" | "settings";
  onClose?: () => void;
  engine?: CaptureEngine;
}) {
  const [tab, setTab] = useState<TabId>("overview");
  const [rangeDays, setRangeDays] = useState<number | null>(90);

  return (
    <div className={`retraced-page retraced-page--${variant}`}>
      <header className="retraced-header">
        <h1 className="retraced-title">Retraced</h1>
        <span className="retraced-version">v{meta.version}</span>
        <div className="retraced-ranges" role="group" aria-label="Time range">
          {RANGES.map((range) => (
            <button
              key={range.label}
              type="button"
              className="retraced-range-pill"
              aria-pressed={rangeDays === range.days}
              onClick={() => setRangeDays(range.days)}
            >
              {range.label}
            </button>
          ))}
        </div>
        {onClose ? (
          <button type="button" className="retraced-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        ) : null}
      </header>
      <nav className="retraced-tabs" role="tablist" aria-label="Statistics sections">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="retraced-tab" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="retraced-body">
        <div className="retraced-content">
          {tab === "overview" ? (
            <OverviewTab engine={engine} rangeDays={rangeDays} />
          ) : tab === "rhythm" ? (
            <RhythmTab engine={engine} rangeDays={rangeDays} />
          ) : tab === "hesitation" ? (
            <HesitationTab engine={engine} rangeDays={rangeDays} />
          ) : tab === "people" ? (
            <PeopleTab engine={engine} rangeDays={rangeDays} />
          ) : tab === "content" ? (
            <ContentTab engine={engine} rangeDays={rangeDays} />
          ) : tab === "voice" ? (
            <VoiceTab engine={engine} rangeDays={rangeDays} />
          ) : (
            <DataTab engine={engine} rangeDays={rangeDays} />
          )}
        </div>
      </main>
    </div>
  );
}

