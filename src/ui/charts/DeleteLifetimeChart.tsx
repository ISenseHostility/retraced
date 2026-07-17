import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { DELETE_BUCKET_LABELS, type DeleteLifetime } from "../data/hesitation";
import { formatCount, type ChartTheme } from "../theme";

/** How long deleted messages lived before deletion. */
export function DeleteLifetimeChart({ data, theme, width }: { data: DeleteLifetime; theme: ChartTheme; width: number }) {
  const rows = data.buckets.map((count, i) => ({ label: DELETE_BUCKET_LABELS[i]!, count }));
  const deleted = theme.series[7]!;

  return (
    <BarChart width={width} height={200} data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} stroke={theme.ink.grid} />
      <XAxis dataKey="label" tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={{ stroke: theme.ink.axis }} tickLine={false} interval={0} />
      <YAxis width={36} tickCount={4} allowDecimals={false} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip
        cursor={{ fill: theme.ink.grid }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]!.payload as { label: string; count: number };
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">lived {row.label}</div>
              <div>{formatCount(row.count)} deletions</div>
            </div>
          );
        }}
      />
      <Bar dataKey="count" fill={deleted} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false} />
    </BarChart>
  );
}
