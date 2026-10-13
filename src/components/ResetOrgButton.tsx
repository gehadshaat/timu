"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetOrgAction } from "@/app/actions";

export function ResetOrgButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Remove the whole org and run setup again? Imported sessions are kept.")) return;
        start(async () => {
          await resetOrgAction();
          router.push("/setup");
        });
      }}
      className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
    >
      {pending ? "Resetting…" : "Rebuild from scratch"}
    </button>
  );
}
