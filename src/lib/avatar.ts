import type { AvatarSpec, PropKind } from "./types";
import { hash } from "./text";

export const SKIN = ["#ffdcb8", "#f3c48f", "#e0a96d", "#c68642", "#8d5524", "#5e3a22"];
export const HAIR_COLORS = ["#2b1d14", "#4a2c1a", "#8a4b22", "#e0a84f", "#b5482a", "#1f2937", "#a3a3a3", "#6d28d9"];
export const OUTFITS = ["#6366f1", "#ef4444", "#10b981", "#f59e0b", "#0ea5e9", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316"];
export const HAIR_STYLES = 8;

export type Pose =
  | "working"
  | "thinking"
  | "reading"
  | "call"
  | "needs_you"
  | "review"
  | "idle"
  | "done"
  | "failed"
  | "walking";

export const POSES: Pose[] = ["working", "thinking", "reading", "call", "needs_you", "review", "idle", "done", "failed", "walking"];

/**
 * Where a small avatar is drawn as an image (see Character): one URL per look and pose, the same on
 * the server and in the browser, so the browser fetches each teammate once and caches it.
 */
export function avatarUrl(spec: AvatarSpec, pose: Pose): string {
  const q = new URLSearchParams({ pose, seed: spec.seed });
  if (spec.prop) q.set("prop", spec.prop);
  for (const k of ["skin", "hair", "hairColor", "outfit"] as const) if (spec[k] != null) q.set(k, String(spec[k]));
  if (spec.glasses != null) q.set("glasses", spec.glasses ? "1" : "0");
  return `/api/avatar?${q}`;
}

const BUSY_POSES: Pose[] = ["working", "working", "thinking", "reading", "call"];

export function isBusy(pose: Pose): boolean {
  return pose === "working" || pose === "thinking" || pose === "reading" || pose === "call";
}

/** Busy teammates don't all type: vary the activity per session so the office looks alive. */
export function busyPoseFor(seed: string): Pose {
  return BUSY_POSES[hash(seed) % BUSY_POSES.length];
}

export interface Traits {
  skin: string;
  hair: number;
  hairColor: string;
  outfit: string;
  glasses: boolean;
  prop: PropKind;
  freckles: boolean;
}

/** Deterministic look for a team member; explicit spec fields win over the seed. */
export function traitsFor(spec: AvatarSpec): Traits {
  const h = hash(spec.seed || "timu");
  const pick = (n: number, shift: number) => (h >>> shift) % n;
  return {
    skin: SKIN[spec.skin ?? pick(SKIN.length, 0)],
    hair: spec.hair ?? pick(HAIR_STYLES, 3),
    hairColor: HAIR_COLORS[spec.hairColor ?? pick(HAIR_COLORS.length, 7)],
    outfit: OUTFITS[spec.outfit ?? pick(OUTFITS.length, 11)],
    glasses: spec.glasses ?? pick(3, 15) === 0,
    freckles: pick(4, 19) === 0,
    prop: spec.prop ?? "mug",
  };
}

/** Map a member's session/task state to the pose their character shows. */
export function poseFor(state: { openTaskKinds: string[]; working: boolean; recentlyDone: boolean }): Pose {
  if (state.openTaskKinds.includes("unblock")) return "failed";
  if (state.openTaskKinds.some((k) => k === "respond" || k === "decide")) return "needs_you";
  if (state.openTaskKinds.includes("review")) return "review";
  if (state.working) return "working";
  if (state.recentlyDone) return "done";
  return "idle";
}

export const POSE_LABEL: Record<Pose, string> = {
  working: "Working",
  thinking: "Thinking",
  reading: "Reading",
  call: "On a call",
  walking: "Out and about",
  needs_you: "Needs you",
  review: "Ready for review",
  idle: "Idle",
  done: "Shipped",
  failed: "Stuck",
};
