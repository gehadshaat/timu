import type { CSSProperties } from "react";
import { hash } from "./text";

/** Each project floor gets a look: wall colour + pattern, floor, and decor. */
export interface OfficeTheme {
  id: string;
  label: string;
  wall: string;
  pattern: "dots" | "stripes" | "bricks" | "waves" | "grid" | "stars";
  patternInk: string;
  floor: string;
  trim: string;
  decor: string[];
  dark?: boolean;
}

export const THEMES: OfficeTheme[] = [
  { id: "sunny", label: "Sunny loft", wall: "#fdecc8", pattern: "dots", patternInk: "rgba(180,120,20,.12)", floor: "#c9a27a", trim: "#f5d08a", decor: ["🪴", "🖼️", "☀️"] },
  { id: "mint", label: "Mint studio", wall: "#d5f5e3", pattern: "stripes", patternInk: "rgba(16,120,80,.08)", floor: "#9fbfa8", trim: "#a7e3c3", decor: ["🌿", "🧃", "📚"] },
  { id: "lavender", label: "Lavender lab", wall: "#e9e0fb", pattern: "grid", patternInk: "rgba(90,60,170,.09)", floor: "#a99bc9", trim: "#cdbdf2", decor: ["🔮", "🧪", "🪐"] },
  { id: "brick", label: "Brick warehouse", wall: "#f3d2c1", pattern: "bricks", patternInk: "rgba(150,60,30,.14)", floor: "#8d6e5d", trim: "#e3a98b", decor: ["🏭", "📦", "🧱"] },
  { id: "ocean", label: "Ocean deck", wall: "#d4ecfb", pattern: "waves", patternInk: "rgba(20,100,170,.12)", floor: "#8fb3c9", trim: "#a5d4f2", decor: ["🐚", "⛵", "🌊"] },
  { id: "night", label: "Night shift", wall: "#2b2f4a", pattern: "stars", patternInk: "rgba(255,255,255,.22)", floor: "#3d3a5c", trim: "#4b4f7a", decor: ["🌙", "💡", "🎧"], dark: true },
];

export function themeById(id: string | null | undefined): OfficeTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function themeForSlug(slug: string): string {
  return THEMES[hash(slug) % THEMES.length].id;
}

/** CSS background for a themed wall. */
export function wallStyle(t: OfficeTheme): CSSProperties {
  const ink = t.patternInk;
  const patterns: Record<OfficeTheme["pattern"], string> = {
    dots: `radial-gradient(circle at 2px 2px, ${ink} 2px, transparent 0) 0 0/20px 20px`,
    stripes: `repeating-linear-gradient(90deg, ${ink} 0 14px, transparent 14px 28px)`,
    grid: `linear-gradient(${ink} 1px, transparent 1px) 0 0/22px 22px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0/22px 22px`,
    bricks: `linear-gradient(${ink} 2px, transparent 2px) 0 0/48px 20px, linear-gradient(90deg, ${ink} 2px, transparent 2px) 0 0/48px 40px, linear-gradient(90deg, ${ink} 2px, transparent 2px) 24px 20px/48px 40px`,
    waves: `radial-gradient(circle at 50% 100%, transparent 9px, ${ink} 10px, transparent 11px) 0 0/24px 14px`,
    stars: `radial-gradient(circle at 3px 3px, ${ink} 1.5px, transparent 0) 0 0/37px 41px, radial-gradient(circle at 2px 2px, ${ink} 1px, transparent 0) 13px 17px/29px 31px`,
  };
  return { background: `${patterns[t.pattern]}, ${t.wall}` };
}
