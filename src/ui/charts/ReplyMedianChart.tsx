import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";
import { REPLY_BUCKET_LABELS, type ReplyMedianRow } from "../data/people";
import { formatCount, type ChartTheme } from "../theme";

/**
 * Median reply time, you vs them, per person. The x-axis is the stored
 * bucket scale (log-ish), so a 6h ghoster doesn't crush everyone at 10s —
 * tick labels are the bucket bounds.
 */

const AXIS_TICK_LABELS = ["0", "10s", "30s", "2m", "10m", "1h", "6h", ""];

export function ReplyMedianChart({
  data,
  youColor,
  themColor,
  theme,
  width,
}: {
  data: ReplyMedianRow[];
  youColor: string;
  themColor: string;
  theme: ChartTheme;
  width: number;
}) {
  const rows = data.map((r) => ({
    ...r,
    minePos: r.mineBucket === null ? null : r.mineBucket + 0.5,
    theirsPos: r.theirsBucket === null ? null : r.theirsBucket + 0.5,
  }));
  const height = 40 + rows.length * 42;

  return (
    <BarChart layout="vertical" width={width} height={height} data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barGap={2}>
      <XAxis
        type="number"
        domain={[0, REPLY_BUCKET_LABELS.length]}
        ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
        tickFormatter={(v: number) => AXIS_TICK_LABELS[v] ?? ""}
        tick={{ fill: theme.ink.muted, fontSize: 11 }}
        axisLine={{ stroke: theme.ink.axis }}
        tickLine={false}
      />
      <YAxis type="category" dataKey="label" width={150} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip
        cursor={{ fill: theme.ink.grid }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]!.payload as ReplyMedianRow;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{row.label}</div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: youColor }} />
                <span>you reply in</span>
                <span className="retraced-tooltip-value">{row.mineBucket === null ? "—" : REPLY_BUCKET_LABELS[row.mineBucket]}</span>
              </div>
              <div className="retraced-tooltip-row">
                <span className="retraced-legend-dot" style={{ background: themColor }} />
                <span>they reply in</span>
                <span className="retraced-tooltip-value">{row.theirsBucket === null ? "—" : REPLY_BUCKET_LABELS[row.theirsBucket]}</span>
              </div>
              <div className="retraced-note">
                medians over {formatCount(row.mineCount)} / {formatCount(row.theirsCount)} replies
              </div>
            </div>
          );
        }}
      />
      <Bar dataKey="minePos" fill={youColor} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
      <Bar dataKey="theirsPos" fill={themColor} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
    </BarChart>
  );
}
