export const STYLE_ID = "retraced-styles";

/**
 * All colours come from Discord's theme variables so Retraced inherits any
 * theme. The literal values are fallbacks only, used if a variable is missing.
 */
export const css = `
.retraced-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  background: var(--background-primary, #313338);
  color: var(--text-normal, #dbdee1);
}

.retraced-page {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  font-family: var(--font-primary, "gg sans", "Noto Sans", "Helvetica Neue", sans-serif);
}

.retraced-page--settings {
  height: 100%;
}

.retraced-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06));
  flex: 0 0 auto;
}

.retraced-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--header-primary, #f2f3f5);
}

.retraced-version {
  font-size: 12px;
  color: var(--text-muted, #949ba4);
}

.retraced-close {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--interactive-normal, #b5bac1);
  font-size: 18px;
  line-height: 1;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.retraced-close:hover {
  color: var(--interactive-hover, #dbdee1);
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.04));
}

.retraced-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 24px 0;
  border-bottom: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06));
  flex: 0 0 auto;
}

.retraced-tab {
  border: none;
  background: none;
  color: var(--interactive-normal, #b5bac1);
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
}

.retraced-tab:hover {
  color: var(--interactive-hover, #dbdee1);
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.04));
}

.retraced-tab[aria-selected="true"] {
  color: var(--interactive-active, #ffffff);
  box-shadow: inset 0 -2px 0 var(--brand-500, var(--brand-experiment, #5865f2));
}

.retraced-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 24px;
}

.retraced-content {
  max-width: 1040px;
  margin: 0 auto;
  width: 100%;
}

.retraced-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.retraced-banner {
  margin: 0;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-normal, #dbdee1);
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.04));
  border-left: 3px solid var(--status-danger, #f23f43);
}

.retraced-ranges {
  display: flex;
  gap: 2px;
  margin-left: 16px;
  padding: 2px;
  border-radius: 6px;
  background: var(--background-secondary, #2b2d31);
}

.retraced-range-pill {
  border: none;
  background: transparent;
  color: var(--interactive-normal, #b5bac1);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.retraced-range-pill:hover {
  color: var(--interactive-hover, #dbdee1);
}

.retraced-range-pill[aria-pressed="true"] {
  color: var(--interactive-active, #ffffff);
  background: var(--background-modifier-selected, rgba(255, 255, 255, 0.12));
}

.retraced-banner--info {
  border-left-color: var(--brand-500, var(--brand-experiment, #5865f2));
}

.retraced-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-left-color: var(--status-warning, #f0b232);
}

.retraced-confirm-buttons {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.retraced-note.retraced-note--nudge {
  color: var(--status-warning, #f0b232);
}

.retraced-input--date {
  flex: 0 0 auto;
  width: 150px;
}

.retraced-ghost-button--danger {
  color: var(--status-danger, #f23f43);
  border-color: color-mix(in srgb, var(--status-danger, #f23f43) 40%, transparent);
}

.retraced-ghost-button--danger:hover {
  color: var(--status-danger, #f23f43);
  background: color-mix(in srgb, var(--status-danger, #f23f43) 12%, transparent);
}

.retraced-chart-card {
  padding: 16px;
  border-radius: 8px;
  background: var(--background-secondary, #2b2d31);
}

.retraced-chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.retraced-chart-title {
  margin: 0 0 2px;
  font-size: 15px;
  font-weight: 700;
  color: var(--header-primary, #f2f3f5);
}

.retraced-ghost-button {
  border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08));
  background: transparent;
  color: var(--interactive-normal, #b5bac1);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  flex: 0 0 auto;
}

.retraced-ghost-button:hover {
  color: var(--interactive-hover, #dbdee1);
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.04));
}

.retraced-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.retraced-chart-card .retraced-ranges {
  margin-left: 0;
  background: var(--background-primary, #313338);
}

.retraced-select {
  border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08));
  background: var(--background-primary, #313338);
  color: var(--text-normal, #dbdee1);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  max-width: 180px;
}

.retraced-slider {
  display: flex;
  align-items: center;
  gap: 8px;
}

.retraced-slider input[type="range"] {
  width: 140px;
  accent-color: var(--brand-500, var(--brand-experiment, #5865f2));
}

.retraced-barlist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.retraced-barlist-row {
  display: grid;
  grid-template-columns: minmax(120px, 180px) 1fr 64px;
  align-items: center;
  gap: 10px;
}

.retraced-barlist-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #949ba4);
  min-width: 0;
}

.retraced-barlist-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retraced-barlist-track {
  height: 14px;
  border-radius: 4px;
  overflow: hidden;
}

.retraced-barlist-bar {
  display: block;
  height: 100%;
  border-radius: 4px;
}

.retraced-barlist-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.retraced-emoji {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}

.retraced-donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  gap: 2px;
}

.retraced-donut-total {
  font-size: 28px;
  font-weight: 700;
  color: var(--header-primary, #f2f3f5);
}

.retraced-words-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.retraced-words-columns > div {
  min-width: 0;
}

.retraced-words-head {
  margin: 0 0 8px;
  font-weight: 600;
}

.retraced-search-controls {
  display: flex;
  gap: 8px;
  margin: 4px 0 12px;
}

.retraced-input {
  flex: 1 1 auto;
  padding: 8px 10px;
  border: none;
  border-radius: 4px;
  background: var(--background-primary, #313338);
  color: var(--text-normal, #dbdee1);
  font-size: 13px;
}

.retraced-search-hint {
  margin: 4px 0;
}

.retraced-search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 420px;
  overflow-y: auto;
}

.retraced-search-hit {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--background-primary, #313338);
}

.retraced-search-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted, #949ba4);
  margin-bottom: 3px;
  flex-wrap: wrap;
}

.retraced-search-content {
  font-size: 13px;
  color: var(--text-normal, #dbdee1);
  word-break: break-word;
}

.retraced-search-content mark {
  background: color-mix(in srgb, var(--brand-500, #5865f2) 35%, transparent);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

.retraced-chip {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
}

.retraced-hero-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0 14px;
}

.retraced-hero-figure {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--header-primary, #f2f3f5);
}

.retraced-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 4px 0 10px;
}

.retraced-legend-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #949ba4);
}

.retraced-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.retraced-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 40px 16px;
  text-align: center;
}

.retraced-empty-title {
  color: var(--header-primary, #f2f3f5);
  font-weight: 600;
}

.retraced-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.retraced-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--background-secondary, #2b2d31);
  min-width: 0;
}

.retraced-card-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted, #949ba4);
}

.retraced-card-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--header-primary, #f2f3f5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.retraced-tooltip {
  background: var(--background-floating, #111214);
  color: var(--text-normal, #dbdee1);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
  pointer-events: none;
  max-width: 260px;
}

.retraced-tooltip-title {
  font-weight: 700;
  color: var(--header-primary, #f2f3f5);
  margin-bottom: 2px;
}

.retraced-tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 0;
}

.retraced-tooltip-value {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.retraced-tooltip--floating {
  position: absolute;
  transform: translate(-50%, -100%);
  z-index: 10;
}

.retraced-table-wrap {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
}

.retraced-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.retraced-table th,
.retraced-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06));
  font-variant-numeric: tabular-nums;
}

.retraced-table th {
  position: sticky;
  top: 0;
  background: var(--background-secondary, #2b2d31);
  color: var(--text-muted, #949ba4);
  font-weight: 600;
}

.retraced-calendar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.retraced-calendar-legend {
  align-items: center;
  margin: 0;
}

.retraced-svg-label {
  font-size: 10px;
  font-family: var(--font-primary, "gg sans", "Noto Sans", sans-serif);
}

.retraced-muted {
  color: var(--text-muted, #949ba4);
}

.retraced-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--text-normal, #dbdee1);
}

.retraced-settings-open {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.retraced-button {
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  color: #ffffff;
  background: var(--brand-500, var(--brand-experiment, #5865f2));
}

.retraced-button:hover {
  filter: brightness(1.1);
}

.retraced-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06));
}

.retraced-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.retraced-row-label {
  color: var(--header-primary, #f2f3f5);
  font-size: 15px;
}

.retraced-note {
  color: var(--text-muted, #949ba4);
  font-size: 12px;
}

.retraced-row--stacked {
  flex-direction: column;
  align-items: stretch;
}

.retraced-textarea {
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 4px;
  background: var(--background-secondary, #2b2d31);
  color: var(--text-normal, #dbdee1);
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
}

.retraced-row input[type="number"] {
  width: 80px;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: var(--background-secondary, #2b2d31);
  color: var(--text-normal, #dbdee1);
}

.retraced-row input[type="checkbox"] {
  width: 20px;
  height: 20px;
  accent-color: var(--brand-500, var(--brand-experiment, #5865f2));
}

.retraced-readout {
  margin-top: 24px;
  padding: 16px;
  border-radius: 8px;
  background: var(--background-secondary, #2b2d31);
  max-width: 720px;
}

.retraced-readout h3 {
  margin: 0 0 8px;
  color: var(--header-primary, #f2f3f5);
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.retraced-status {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--background-modifier-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-muted, #949ba4);
}

.retraced-status--running {
  background: color-mix(in srgb, var(--status-positive, #23a559) 25%, transparent);
  color: var(--status-positive, #23a559);
}

.retraced-status--degraded,
.retraced-status--unavailable {
  background: color-mix(in srgb, var(--status-danger, #f23f43) 20%, transparent);
  color: var(--status-danger, #f23f43);
}

.retraced-counter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
  margin: 12px 0;
}

.retraced-counter {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--background-primary, #313338);
}

.retraced-counter-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--header-primary, #f2f3f5);
  font-variant-numeric: tabular-nums;
}

.retraced-devtools {
  margin-top: 12px;
}

.retraced-devtools-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 8px 0;
}

.retraced-button--danger {
  background: var(--status-danger, #f23f43);
}

.retraced-button:disabled {
  opacity: 0.5;
  cursor: default;
}
`;
