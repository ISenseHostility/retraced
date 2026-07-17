import { sankey, sankeyJustify, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import { useMemo, useState } from "react";
import type { SankeyData } from "../data/selectors";
import { colorForSlot, formatCompact, type ChartTheme } from "../theme";

interface NodeDatum {
  id: string;
  label: string;
  colorSlot: number;
  kind: string;
}

interface LinkDatum {
  source: string;
  target: string;
  value: number;
}

type LaidNode = SankeyNode<NodeDatum, LinkDatum>;
type LaidLink = SankeyLink<NodeDatum, LinkDatum>;

/** Hero flow: You → servers/DMs → the channels that soak up your messages. */
export function SankeyFlow({ data, theme, width }: { data: SankeyData; theme: ChartTheme; width: number }) {
  const height = 340;
  const [activeLink, setActiveLink] = useState<number | null>(null);

  const layout = useMemo(() => {
    const generator = sankey<NodeDatum, LinkDatum>()
      .nodeId((d) => d.id)
      .nodeWidth(10)
      .nodePadding(14)
      .nodeAlign(sankeyJustify)
      .extent([
        [4, 10],
        [width - 4, height - 10],
      ]);
    return generator({
      nodes: data.nodes.map((n) => ({ ...n })),
      links: data.links.map((l) => ({ ...l })),
    });
  }, [data, width]);

  const nodeColor = (node: LaidNode): string => colorForSlot(theme, node.colorSlot);

  return (
    <svg width={width} height={height} role="img" aria-label="Message flow from you to servers and channels">
      <defs>
        {layout.links.map((link, i) => {
          const source = link.source as LaidNode;
          const target = link.target as LaidNode;
          return (
            <linearGradient key={i} id={`retraced-sankey-${i}`} gradientUnits="userSpaceOnUse" x1={source.x1 ?? 0} x2={target.x0 ?? 0}>
              <stop offset="0%" stopColor={nodeColor(source)} />
              <stop offset="100%" stopColor={nodeColor(target)} />
            </linearGradient>
          );
        })}
      </defs>
      <g fill="none">
        {layout.links.map((link: LaidLink, i) => (
          <path
            key={i}
            d={sankeyLinkHorizontal()(link) ?? undefined}
            stroke={`url(#retraced-sankey-${i})`}
            strokeWidth={Math.max(1, link.width ?? 1)}
            strokeOpacity={activeLink === null ? 0.3 : activeLink === i ? 0.65 : 0.12}
            onMouseEnter={() => setActiveLink(i)}
            onMouseLeave={() => setActiveLink(null)}
          >
            <title>{`${(link.source as LaidNode).label} → ${(link.target as LaidNode).label}: ${link.value} messages`}</title>
          </path>
        ))}
      </g>
      <g>
        {layout.nodes.map((node: LaidNode) => {
          const x0 = node.x0 ?? 0;
          const y0 = node.y0 ?? 0;
          const nodeHeight = Math.max(2, (node.y1 ?? 0) - y0);
          const isLast = !node.sourceLinks || node.sourceLinks.length === 0;
          const labelX = isLast ? x0 - 7 : (node.x1 ?? 0) + 7;
          return (
            <g key={node.id}>
              <rect x={x0} y={y0} width={(node.x1 ?? 0) - x0} height={nodeHeight} rx={3} fill={nodeColor(node)}>
                <title>{`${node.label}: ${node.value ?? 0} messages`}</title>
              </rect>
              <text
                x={labelX}
                y={y0 + nodeHeight / 2}
                dominantBaseline="middle"
                textAnchor={isLast ? "end" : "start"}
                className="retraced-svg-label"
                fill={theme.ink.primary}
              >
                {node.label}
                <tspan fill={theme.ink.muted}>{`  ${formatCompact(node.value ?? 0)}`}</tspan>
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
