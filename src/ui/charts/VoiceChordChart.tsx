import { chord as d3chord, ribbon as d3ribbon } from "d3-chord";
import { arc as d3arc } from "d3-shape";
import { useMemo, useState } from "react";
import type { ChordData } from "../data/voicetab";
import { colorForSlot, formatMinutes, type ChartTheme } from "../theme";

/**
 * Chord diagram of voice co-occurrence: you and your circle around the ring,
 * ribbons weighted by shared minutes. Hover an arc to isolate one person.
 */
export function VoiceChordChart({ data, theme, width }: { data: ChordData; theme: ChartTheme; width: number }) {
  const [hover, setHover] = useState<number | null>(null);

  const height = 380;
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(cx, cy) - 34;
  const inner = outer - 12;

  const layout = useMemo(() => d3chord().padAngle(0.06)(data.matrix), [data]);
  const arcGen = d3arc().innerRadius(inner).outerRadius(outer);
  const ribbonGen = d3ribbon().radius(inner - 3);

  const colorOf = (i: number): string => (i === 0 ? theme.ink.primary : colorForSlot(theme, i - 1));
  const dimmed = (a: number, b: number): boolean => hover !== null && a !== hover && b !== hover;

  return (
    <svg width={width} height={height} role="img" aria-label="Shared voice time">
      <g transform={`translate(${cx},${cy})`}>
        {layout.map((c, i) => (
          <path
            key={i}
            d={ribbonGen({ source: c.source, target: c.target } as never) as unknown as string}
            fill={colorOf(c.source.index)}
            fillOpacity={dimmed(c.source.index, c.target.index) ? 0.06 : 0.55}
            stroke={theme.ink.card}
            strokeWidth={1}
          >
            <title>{`${data.names[c.source.index]} ↔ ${data.names[c.target.index]} — ${formatMinutes(c.source.value)} shared`}</title>
          </path>
        ))}
        {layout.groups.map((g) => {
          const mid = (g.startAngle + g.endAngle) / 2;
          const labelR = outer + 10;
          const x = Math.sin(mid) * labelR;
          const y = -Math.cos(mid) * labelR;
          return (
            <g key={g.index} onMouseEnter={() => setHover(g.index)} onMouseLeave={() => setHover(null)}>
              <path
                d={arcGen({ startAngle: g.startAngle, endAngle: g.endAngle } as never) as unknown as string}
                fill={colorOf(g.index)}
                fillOpacity={hover === null || hover === g.index ? 1 : 0.3}
                stroke={theme.ink.card}
                strokeWidth={1.5}
              />
              <text
                x={x}
                y={y + 3}
                textAnchor={mid > Math.PI ? "end" : "start"}
                className="retraced-svg-label"
                fill={hover === g.index ? theme.ink.primary : theme.ink.muted}
                fontWeight={g.index === 0 ? 600 : 400}
              >
                {data.names[g.index]}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
