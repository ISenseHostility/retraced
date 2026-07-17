import { Cell, Pie, PieChart, Tooltip } from "recharts";
import type { TypeSlice } from "../data/content";
import { colorForSlot, formatCompact, formatCount, type ChartTheme } from "../theme";

/** Part-to-whole of content types — ≤6 fixed-slot segments, total in the middle. */
export function ContentTypeDonut({
  data,
  theme,
  width,
}: {
  data: { slices: TypeSlice[]; total: number };
  theme: ChartTheme;
  width: number;
}) {
  return (
    <div style={{ position: "relative" }}>
      <PieChart width={width} height={260}>
        <Pie
          data={data.slices}
          dataKey="count"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={72}
          outerRadius={104}
          stroke={theme.ink.card}
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.slices.map((slice) => (
            <Cell key={slice.key} fill={colorForSlot(theme, slice.colorSlot)} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const slice = payload[0]!.payload as TypeSlice;
            return (
              <div className="retraced-tooltip">
                <div className="retraced-tooltip-title">{slice.label}</div>
                <div>
                  {formatCount(slice.count)} messages · {Math.round((100 * slice.count) / Math.max(1, data.total))}%
                </div>
              </div>
            );
          }}
        />
      </PieChart>
      <div className="retraced-donut-center">
        <span className="retraced-donut-total">{formatCompact(data.total)}</span>
        <span className="retraced-note">type tags</span>
      </div>
    </div>
  );
}
