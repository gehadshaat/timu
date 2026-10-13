/** Collapse whitespace and cut to `max` characters with an ellipsis. */
export function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Strip the system-reminder / command wrappers Claude Code puts in user turns. */
export function stripHarnessTags(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<command-(name|message|args)>[\s\S]*?<\/command-\1>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .trim();
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 48) || "project"
  );
}

/** "https://github.com/sunbeam-co/sunbeam-web" -> "sunbeam-co/sunbeam-web" */
export function repoFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?/i);
  return m ? m[1] : url;
}

/** Deterministic 32-bit hash for picking avatar traits and colours. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
