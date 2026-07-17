import { useSyncExternalStore } from "react";
import type { SettingsStore } from "./index";

export function SettingsPanel({ store, onOpenStats }: { store: SettingsStore; onOpenStats: () => void }) {
  const s = useSyncExternalStore(store.subscribe, store.get);

  return (
    <div className="retraced-settings-panel">
      <div className="retraced-settings-open">
        <button type="button" className="retraced-button" onClick={onOpenStats}>
          Open statistics page
        </button>
        <span className="retraced-note">
          …or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> anywhere in Discord.
        </span>
      </div>
      <SwitchRow
        label="Store message content"
        note="Keep message text on this device — DMs from both sides, servers your own messages only. Turning this off also erases already-stored text (search included); counts and statistics survive."
        checked={s.contentStorageEnabled}
        onChange={(v) => store.update({ contentStorageEnabled: v })}
      />
      <NumberRow
        label="Conversation gap (minutes)"
        note="Silence longer than this starts a new conversation."
        value={s.conversationGapMinutes}
        min={5}
        max={240}
        onChange={(v) => store.update({ conversationGapMinutes: v })}
      />
      <NumberRow
        label="Raw event retention (days)"
        note="How long the rebuildable raw event log is kept. Computed statistics are kept forever."
        value={s.eventRetentionDays}
        min={7}
        max={365}
        onChange={(v) => store.update({ eventRetentionDays: v })}
      />
      <NumberRow
        label="Message retention (days)"
        note="How long stored message text is kept. 0 keeps it forever; statistics survive either way."
        value={s.messagesRetentionDays}
        min={0}
        max={3650}
        onChange={(v) => store.update({ messagesRetentionDays: v })}
      />
      <StopwordsRow value={s.stopWords} onChange={(v) => store.update({ stopWords: v })} />
    </div>
  );
}

function StopwordsRow({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="retraced-row retraced-row--stacked">
      <span className="retraced-row-text">
        <span className="retraced-row-label">Stopwords</span>
        <span className="retraced-note">
          Hidden from the most-used-words charts. Comma or space separated; applies immediately, nothing is re-counted.
        </span>
      </span>
      <textarea
        className="retraced-textarea"
        rows={3}
        defaultValue={value.join(", ")}
        onBlur={(e) => {
          const words = [...new Set(e.currentTarget.value.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 0))];
          onChange(words);
        }}
      />
    </label>
  );
}

function SwitchRow({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="retraced-row">
      <span className="retraced-row-text">
        <span className="retraced-row-label">{label}</span>
        <span className="retraced-note">{note}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

function NumberRow({
  label,
  note,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  note: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="retraced-row">
      <span className="retraced-row-text">
        <span className="retraced-row-label">{label}</span>
        <span className="retraced-note">{note}</span>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Math.round(Number(e.currentTarget.value));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}
