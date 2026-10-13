import { clip } from "../text";

/**
 * Claude artifacts: pages published to claude.ai (claude.ai/artifact/<id>, or
 * claude.ai/code/artifact/<uuid> for ones made in Claude Code). Timu learns about them two ways:
 * the list Claude prints when asked for your artifacts (pasted, or sent through the
 * import_artifacts MCP tool), and links to them inside session transcripts.
 */

export interface ArtifactIn {
  id: string;
  url: string;
  title: string | null;
  owner: "mine" | "shared" | null;
  updated_at: string | null;
}

const LINK = /https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]{6,})/g;

/** The id in an artifact link, or null when it isn't one. */
export function artifactIdFromUrl(url: string): string | null {
  const m = url.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/** Every distinct artifact link mentioned in some text (a transcript, a summary). */
export function extractArtifactLinks(text: string | null | undefined): { id: string; url: string }[] {
  if (!text) return [];
  const out = new Map<string, string>();
  for (const m of text.matchAll(LINK)) if (!out.has(m[1])) out.set(m[1], m[0]);
  return [...out].map(([id, url]) => ({ id, url }));
}

/**
 * Read an artifacts list in whatever shape it arrives:
 * - the lines Claude prints: "- (mine) Sunbeam SEO Audit — https://claude.ai/artifact/AbC… — updated 2026-10-13"
 * - JSON: an array, or {data|artifacts: [...]}, of objects with url (or id) and title / name, updated_at
 */
export function parseArtifactList(payload: unknown): ArtifactIn[] {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return parseArtifactList(JSON.parse(trimmed));
      } catch {
        // Not JSON after all; read it as lines.
      }
    }
    const rows: ArtifactIn[] = [];
    for (const line of payload.split("\n")) {
      const url = line.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]{6,}/)?.[0];
      const id = url ? artifactIdFromUrl(url) : null;
      if (!url || !id) continue;
      const owner = /\(\s*mine\s*\)/i.test(line) ? "mine" : /\(\s*shared/i.test(line) ? "shared" : null;
      const before = line.slice(0, line.indexOf(url)).replace(/^\s*[-*•]\s*/, "").replace(/\((mine|shared[^)]*)\)/i, "");
      const title = before.replace(/[\s—–:-]+$/, "").trim() || null;
      const updated = line.slice(line.indexOf(url) + url.length).match(/(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)/)?.[1] ?? null;
      rows.push({ id, url, title: clip(title, 200), owner, updated_at: updated });
    }
    return dedupe(rows);
  }
  if (Array.isArray(payload)) {
    return dedupe(
      payload.flatMap((v): ArtifactIn[] => {
        if (!v || typeof v !== "object") return [];
        const o = v as Record<string, unknown>;
        const url = typeof o.url === "string" ? o.url : typeof o.link === "string" ? o.link : null;
        const id = (url && artifactIdFromUrl(url)) || (typeof o.id === "string" ? o.id : null);
        if (!id) return [];
        const title = [o.title, o.name].find((x): x is string => typeof x === "string") ?? null;
        const updated = [o.updated_at, o.updatedAt, o.updated].find((x): x is string => typeof x === "string") ?? null;
        const owner = o.owner === "mine" || o.mine === true ? "mine" : o.owner === "shared" || o.shared === true ? "shared" : null;
        return [{ id, url: url ?? `https://claude.ai/artifact/${id}`, title: clip(title, 200), owner, updated_at: updated }];
      }),
    );
  }
  if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const k of ["data", "artifacts", "items"]) if (Array.isArray(o[k])) return parseArtifactList(o[k]);
  }
  return [];
}

function dedupe(rows: ArtifactIn[]): ArtifactIn[] {
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

/**
 * The artifacts a Claude Code session published: links in the results of its Artifact tool's
 * publish calls. Links it merely mentions, reads or lists don't count — a session that lists your
 * gallery would otherwise claim every artifact you have.
 */
export function publishedArtifactLinks(jsonl: string): { id: string; url: string }[] {
  const publishCalls = new Set<string>();
  const found = new Map<string, string>();
  for (const raw of jsonl.split("\n")) {
    if (!raw.includes('"tool_use') && !raw.includes('"tool_result')) continue;
    let line: { message?: { content?: unknown } };
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as { type?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown }[]) {
      if (b.type === "tool_use" && b.name === "Artifact" && b.id) {
        const action = b.input?.action;
        // publish is the default action; an asset upload isn't a page of its own.
        if ((action === undefined || action === "publish") && !b.input?.asset) publishCalls.add(b.id);
      } else if (b.type === "tool_result" && b.tool_use_id && publishCalls.has(b.tool_use_id)) {
        const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        for (const l of extractArtifactLinks(text)) if (!found.has(l.id)) found.set(l.id, l.url);
      }
    }
  }
  return [...found].map(([id, url]) => ({ id, url }));
}
