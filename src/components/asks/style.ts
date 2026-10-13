import type { Pose } from "@/lib/avatar";

export const ENGINE_ICON: Record<string, string> = { typesafe: "🧠", claude: "✨", rules: "📏", status: "📡", you: "👤" };

export const KIND_POSE: Record<string, Pose> = { respond: "needs_you", decide: "needs_you", review: "review", unblock: "failed", run: "failed" };

export const KIND_STYLE: Record<string, string> = {
  respond: "bg-rose-500",
  decide: "bg-fuchsia-500",
  review: "bg-amber-500",
  unblock: "bg-orange-500",
  run: "bg-orange-500",
};
