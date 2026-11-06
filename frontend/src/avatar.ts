/** Avatar fallbacks: `AgentSummary` has no avatar field, so derive one. */

export const TONE_COUNT = 6;

export interface ToneStyle {
  backgroundColor: string;
  color: string;
}

/** Warm, low-saturation washes that match the console's accent family. */
const LIGHT: ToneStyle[] = [
  { backgroundColor: "#fff1e6", color: "#b85800" },
  { backgroundColor: "#e8f0ff", color: "#1f5fbf" },
  { backgroundColor: "#e9f6ec", color: "#2f7a3b" },
  { backgroundColor: "#f2ecfe", color: "#6b40b3" },
  { backgroundColor: "#fde9ef", color: "#b02a55" },
  { backgroundColor: "#e3f5f3", color: "#0d7a70" },
];

/** Dark mode keeps the hue, drops the pastel fill. */
const DARK: ToneStyle[] = [
  { backgroundColor: "rgba(255,140,40,.18)", color: "#ffb066" },
  { backgroundColor: "rgba(90,150,255,.2)", color: "#9cc2ff" },
  { backgroundColor: "rgba(90,200,120,.18)", color: "#95dba7" },
  { backgroundColor: "rgba(170,130,255,.2)", color: "#c9b2ff" },
  { backgroundColor: "rgba(255,110,160,.18)", color: "#ffa8c4" },
  { backgroundColor: "rgba(60,200,190,.18)", color: "#7fdcd4" },
];

/** First code point, so emoji and astral characters are never split. */
export function initialOf(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const first = Array.from(trimmed)[0] ?? "?";
  return first.toUpperCase();
}

/** Stable tone index for a name — the same agent always gets the same color. */
export function toneOf(seed: string): number {
  let hash = 0;
  const text = seed ?? "";
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 100000;
  }
  return hash % TONE_COUNT;
}

export function toneStyle(tone: number, mode: "light" | "dark"): ToneStyle {
  const palette = mode === "dark" ? DARK : LIGHT;
  return palette[tone % TONE_COUNT] ?? palette[0]!;
}
