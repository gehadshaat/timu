import { Character } from "@/components/Character";
import { POSE_LABEL, type Pose } from "@/lib/avatar";
import { PROP_KINDS } from "@/lib/classify/schema";

const POSES = Object.keys(POSE_LABEL) as Pose[];

/** Every pose and prop in the character kit, for checking art changes. */
export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 px-6 py-10">
      <h1 className="font-display text-3xl font-bold">Character kit</h1>
      <section>
        <h2 className="mb-3 font-display text-xl font-bold">Seated poses</h2>
        <div className="flex flex-wrap gap-4">
          {POSES.filter((p) => p !== "walking").map((p, i) => (
            <figure key={p} className="rounded-2xl bg-white p-2 text-center ring-1 ring-black/5">
              <Character spec={{ seed: `pose-${i}`, prop: PROP_KINDS[i % PROP_KINDS.length] }} pose={p} size={150} />
              <figcaption className="text-xs font-semibold text-zinc-500">{POSE_LABEL[p]}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-display text-xl font-bold">Standing</h2>
        <div className="flex flex-wrap items-end gap-4">
          {(["idle", "walking", "needs_you", "review", "done"] as Pose[]).map((p, i) => (
            <figure key={p} className="rounded-2xl bg-white p-2 text-center ring-1 ring-black/5">
              <Character spec={{ seed: `stand-${i}`, prop: "stethoscope" }} pose={p} stance="standing" size={110} carry={p === "walking" ? "mug" : undefined} />
              <figcaption className="text-xs font-semibold text-zinc-500">{POSE_LABEL[p]}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 font-display text-xl font-bold">Props</h2>
        <div className="flex flex-wrap gap-4">
          {PROP_KINDS.map((prop, i) => (
            <figure key={prop} className="rounded-2xl bg-white p-2 text-center ring-1 ring-black/5">
              <Character spec={{ seed: `prop-${i}`, prop }} pose="working" size={120} />
              <figcaption className="text-xs font-semibold text-zinc-500">{prop}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  );
}
