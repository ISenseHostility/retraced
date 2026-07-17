import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";
import type { PeerTyping } from "../data/hesitation";
import { formatCount, type ChartTheme } from "../theme";

/** "Who do you type at and then delete?" — DM-scoped aborted typing per person. */
export function PeerHesitationChart({ data, theme, width }: { data: PeerTyping[]; theme: ChartTheme; width: number }) {
  const height = 40 + data.length * 28;
  const aborted = theme.series[5]!;

  return (
    <BarChart layout="vertical" width={width} height={height} data={data} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
      <XAxis type="number" allowDecimals={false} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={{ stroke: theme.ink.axis }} tickLine={false} />
      <YAxis type="category" dataKey="label" width={140} tick={{ fill: theme.ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
      <Tooltip
        cursor={{ fill: theme.ink.grid }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]!.payload as PeerTyping;
          return (
            <div className="retraced-tooltip">
              <div className="retraced-tooltip-title">{row.label}</div>
              <div>{formatCount(row.aborted)} abandoned typing runs</div>
            </div>
          );
        }}
      />
      <Bar dataKey="aborted" fill={aborted} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
    </BarChart>
  );
}
