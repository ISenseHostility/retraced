/**
 * Chart color system. Chrome/ink comes from Discord's live CSS variables
 * (resolved once per page open, with fallbacks for both themes); the series
 * palettes are fixed hexes validated against Discord's card surfaces
 * (dark #2b2d31, light #f2f3f5) — see docs/SPEC.md §5 and the dataviz notes
 * in the README. Contrast WARN slots rely on the relief rule: every
 * multi-series chart ships a legend and a data-table view.
 */

export interface ChartTheme {
  mode: "dark" | "light";
  /** categorical slots, fixed order — assignment follows the entity, never the rank */
  series: string[];
  otherColor: string;
  calendarBins: string[];
  calendarZero: string;
  /** 5-step ordinal blue ramp (message-length bands) — validated with --ordinal against Discord surfaces */
  lengthRamp: string[];
  ink: {
    primary: string;
    muted: string;
    grid: string;
    axis: string;
    surface: string;
    card: string;
  };
}

const DARK_SERIES = ["#3987e5", "#008300", "#d55181", "#c98500", "#199e70", "#d95926", "#9085e9", "#e66767"];
const LIGHT_SERIES = ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834", "#4a3aa7", "#e34948"];

// sequential blue ramp steps; ascending magnitude must ascend visibility on the
// surface — the dark ramp ends bright and saturated, never pastel
const DARK_CALENDAR = ["#14406e", "#1a5fae", "#2a78d6", "#6da7ec"];
const LIGHT_CALENDAR = ["#b7d3f6", "#6da7ec", "#2a78d6", "#184f95"];

// ordinal (discrete ordered bands): the surface-nearest step must clear 2:1
const DARK_LENGTH_RAMP = ["#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"];
const LIGHT_LENGTH_RAMP = ["#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

function luminanceOf(color: string): number | null {
  let r: number, g: number, b: number;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (hex) {
    r = parseInt(hex[1]!.slice(0, 2), 16);
    g = parseInt(hex[1]!.slice(2, 4), 16);
    b = parseInt(hex[1]!.slice(4, 6), 16);
  } else if (rgb) {
    [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  } else {
    return null;
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function readChartTheme(): ChartTheme {
  let styles: CSSStyleDeclaration | null = null;
  let mode: "dark" | "light" = "dark";
  try {
    styles = getComputedStyle(document.body);
    const background = styles.getPropertyValue("--background-primary").trim();
    const luminance = background ? luminanceOf(background) : null;
    if (luminance !== null) mode = luminance > 0.5 ? "light" : "dark";
  } catch {
    /* no DOM styles (tests) — dark defaults */
  }

  const cssVar = (name: string, fallback: string): string => {
    const value = styles?.getPropertyValue(name).trim();
    return value || fallback;
  };

  const dark = mode === "dark";
  return {
    mode,
    series: dark ? DARK_SERIES : LIGHT_SERIES,
    otherColor: dark ? "#80848e" : "#6d6f78",
    calendarBins: dark ? DARK_CALENDAR : LIGHT_CALENDAR,
    calendarZero: dark ? "rgba(255,255,255,0.055)" : "rgba(6,6,7,0.06)",
    lengthRamp: dark ? DARK_LENGTH_RAMP : LIGHT_LENGTH_RAMP,
    ink: {
      primary: cssVar("--header-primary", dark ? "#f2f3f5" : "#060607"),
      muted: cssVar("--text-muted", dark ? "#949ba4" : "#5c5e66"),
      grid: dark ? "rgba(255,255,255,0.06)" : "rgba(6,6,7,0.08)",
      axis: dark ? "rgba(255,255,255,0.16)" : "rgba(6,6,7,0.16)",
      surface: cssVar("--background-primary", dark ? "#313338" : "#ffffff"),
      card: cssVar("--background-secondary", dark ? "#2b2d31" : "#f2f3f5"),
    },
  };
}

/** slot -2 = the root/"You" (primary ink), -1 = "Other" gray, 0.. = series */
export function colorForSlot(theme: ChartTheme, slot: number): string {
  if (slot === -2) return theme.ink.primary;
  if (slot < 0) return theme.otherColor;
  return theme.series[slot % theme.series.length]!;
}

export const formatCount = (n: number): string => n.toLocaleString("en-US");

export const formatCompact = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : formatCount(n);

export const formatMinutes = (minutes: number): string =>
  minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
