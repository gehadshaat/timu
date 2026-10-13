"use server";

import { buildSearchIndex } from "@/lib/search-index";
import type { Searchable } from "@/lib/search";

/**
 * The command palette loads the whole index once when it opens and ranks locally as
 * you type, so typing never waits on the server.
 */
export async function searchIndexAction(): Promise<Searchable[]> {
  return buildSearchIndex();
}
