import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { HAIR_COLORS, HAIR_STYLES, OUTFITS, POSES, SKIN, type Pose } from "@/lib/avatar";
import { PROP_KINDS } from "@/lib/classify/schema";
import type { AvatarSpec, PropKind } from "@/lib/types";
import { CHARACTER_CSS } from "./character-css";
import { CharacterSvg } from "./Character";

/** SVG attributes that keep their camelCase; React writes every other camelCase prop as kebab-case. */
const CAMEL = new Set(["viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform", "patternUnits", "patternTransform", "clipPathUnits", "markerWidth", "markerHeight", "refX", "refY", "stdDeviation", "pathLength", "textLength"]);
const attrName = (k: string) => (k === "className" ? "class" : CAMEL.has(k) ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * Static markup for a tree of plain function components and SVG elements: what React's
 * renderToStaticMarkup gives (avatar.test.ts checks), which Next keeps out of route handlers.
 * Hooks, style objects and event handlers aren't supported; Character uses none.
 */
export function svgMarkup(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return escape(String(node));
  if (Array.isArray(node)) return node.map(svgMarkup).join("");
  if (!isValidElement(node)) throw new Error("svgMarkup: unsupported node");
  const { type, props } = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if (type === Fragment) return svgMarkup(props.children);
  if (typeof type === "function") return svgMarkup((type as (p: typeof props) => ReactNode)(props));
  if (typeof type !== "string") throw new Error("svgMarkup: unsupported element");
  let attrs = "";
  for (const [k, v] of Object.entries(props)) {
    if (k === "children" || v == null || v === false) continue;
    if (typeof v === "object" || typeof v === "function") throw new Error(`svgMarkup: unsupported prop ${k}`);
    attrs += ` ${attrName(k)}="${escape(String(v))}"`;
  }
  return `<${type}${attrs}>${svgMarkup(props.children)}</${type}>`;
}

/** One small avatar as a standalone SVG document, with its animations (served by /api/avatar). */
export function avatarSvg(spec: AvatarSpec, pose: Pose): string {
  const markup = svgMarkup(createElement(CharacterSvg, { spec, pose, desk: false, size: 144 }));
  return markup.replace(/^<svg([^>]*)>/, `<svg xmlns="http://www.w3.org/2000/svg"$1><style>${CHARACTER_CSS}</style>`);
}

/** The avatar an /api/avatar URL asks for (see avatarUrl), or null when it isn't one. */
export function avatarFromQuery(q: URLSearchParams): { spec: AvatarSpec; pose: Pose } | null {
  const pose = q.get("pose") as Pose;
  const seed = q.get("seed");
  if (!POSES.includes(pose) || seed == null || seed.length > 300) return null;
  const spec: AvatarSpec = { seed };
  const prop = q.get("prop");
  if (prop) {
    if (!(PROP_KINDS as readonly string[]).includes(prop)) return null;
    spec.prop = prop as PropKind;
  }
  const limits = { skin: SKIN.length, hair: HAIR_STYLES, hairColor: HAIR_COLORS.length, outfit: OUTFITS.length };
  for (const [k, max] of Object.entries(limits) as [keyof typeof limits, number][]) {
    const v = q.get(k);
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= max) return null;
    spec[k] = n;
  }
  const glasses = q.get("glasses");
  if (glasses != null) spec.glasses = glasses === "1";
  return { spec, pose };
}
