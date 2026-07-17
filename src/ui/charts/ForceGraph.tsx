import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { useMemo, useState } from "react";
import type { GraphLink, GraphNode } from "../data/people";
import { formatCount, type ChartTheme } from "../theme";

/**
 * Ego-centred social graph: you pinned in the middle, DM partners around you
 * (sized by message volume), teal links between people who share voice time
 * with you. The simulation settles synchronously (~40 nodes, a few ms) and
 * renders statically — no animation loop, nothing on the UI thread later.
 */

interface SimNode extends GraphNode {
  x: number;
  y: number;
  fx?: number;
  fy?: number;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
  weight: number;
  kind: "dm" | "voice";
}

const HEIGHT = 400;
const LABELED_PEERS = 10;

export function ForceGraph({
  data,
  theme,
  width,
}: {
  data: { nodes: GraphNode[]; links: GraphLink[] };
  theme: ChartTheme;
  width: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const maxVolume = Math.max(...data.nodes.filter((n) => !n.isYou).map((n) => n.volume), 1);
    const radiusOf = (n: GraphNode): number => (n.isYou ? 22 : 7 + 15 * Math.sqrt(n.volume / maxVolume));

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n, x: 0, y: 0 }));
    const links = data.links.map((l) => ({ ...l })) as unknown as SimLink[];
    const you = nodes.find((n) => n.isYou);
    if (you) {
      you.fx = width / 2;
      you.fy = HEIGHT / 2;
    }

    const simulation = forceSimulation(nodes as never[])
      .force(
        "link",
        forceLink(links as never[])
          .id((d) => (d as SimNode).id)
          .distance((l) => ((l as SimLink).kind === "voice" ? 140 : 190 - 80 * ((l as SimLink).weight / (maxVolume * 2))))
          .strength((l) => ((l as SimLink).kind === "voice" ? 0.05 : 0.25))
      )
      .force("charge", forceManyBody().strength(-320))
      .force("x", forceX(width / 2).strength(0.04))
      .force("y", forceY(HEIGHT / 2).strength(0.06))
      .force("collide", forceCollide((n) => radiusOf(n as SimNode) + 18))
      .stop();
    for (let i = 0; i < 250; i++) simulation.tick();

    for (const node of nodes) {
      const r = radiusOf(node);
      node.x = Math.max(r + 4, Math.min(width - r - 4, node.x));
      node.y = Math.max(r + 4, Math.min(HEIGHT - r - 4, node.y));
    }

    const labeled = new Set(
      [...nodes]
        .filter((n) => !n.isYou)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, LABELED_PEERS)
        .map((n) => n.id)
    );
    return { nodes, links, radiusOf, labeled };
  }, [data, width]);

  const adjacent = useMemo(() => {
    if (!hover) return null;
    const ids = new Set([hover]);
    for (const l of layout.links) {
      if (l.source.id === hover) ids.add(l.target.id);
      if (l.target.id === hover) ids.add(l.source.id);
    }
    return ids;
  }, [hover, layout]);

  const dimmed = (id: string): boolean => adjacent !== null && !adjacent.has(id);
  const linkDimmed = (l: SimLink): boolean => adjacent !== null && !(adjacent.has(l.source.id) && adjacent.has(l.target.id));
  const hovered = hover ? layout.nodes.find((n) => n.id === hover) : null;

  return (
    <div style={{ position: "relative" }}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Your social graph">
        {layout.links.map((l, i) => (
          <line
            key={i}
            x1={l.source.x}
            y1={l.source.y}
            x2={l.target.x}
            y2={l.target.y}
            stroke={l.kind === "voice" ? theme.series[4] : theme.otherColor}
            strokeWidth={Math.max(1, Math.min(l.kind === "voice" ? 4 : 5, Math.sqrt(l.weight) / 4))}
            strokeOpacity={linkDimmed(l) ? 0.08 : l.kind === "voice" ? 0.7 : 0.35}
          />
        ))}
        {layout.nodes.map((n) => (
          <g key={n.id} opacity={dimmed(n.id) ? 0.3 : 1}>
            <circle
              cx={n.x}
              cy={n.y}
              r={layout.radiusOf(n)}
              fill={n.isYou ? theme.ink.primary : theme.series[0]}
              stroke={theme.ink.card}
              strokeWidth={2}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{n.isYou ? "you" : `${n.label} — ${formatCount(n.volume)} messages`}</title>
            </circle>
            {n.isYou || layout.labeled.has(n.id) || hover === n.id ? (
              <text
                x={n.x}
                y={n.y + layout.radiusOf(n) + 12}
                textAnchor="middle"
                className="retraced-svg-label"
                fill={n.isYou || hover === n.id ? theme.ink.primary : theme.ink.muted}
                fontWeight={n.isYou ? 600 : 400}
              >
                {n.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {hovered && !hovered.isYou ? (
        <div
          className="retraced-tooltip retraced-tooltip--floating"
          style={{ left: hovered.x, top: hovered.y - layout.radiusOf(hovered) - 6 }}
        >
          <div className="retraced-tooltip-title">{hovered.label}</div>
          <div>{formatCount(hovered.volume)} messages, both directions</div>
        </div>
      ) : null}
    </div>
  );
}
