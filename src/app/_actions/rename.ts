"use server";

import { revalidatePath } from "next/cache";
import { renameEntity, type RenameKind, type RenameResult } from "@/lib/rename";

export type { RenameKind, RenameResult } from "@/lib/rename";

export async function renameAction(kind: RenameKind, id: string, name: string): Promise<RenameResult> {
  const r = await renameEntity(kind, id, name);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
