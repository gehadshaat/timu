/** Canonical page URLs for every entity, so names can link anywhere they appear. */
export const companyHref = (slug: string) => `/companies/${slug}`;
export const projectHref = (slug: string) => `/projects/${slug}`;
export const teamHref = (id: string) => `/teams/${id}`;
export const personHref = (id: string) => `/people/${id}`;
export const goalHref = (id: string) => `/goals/${id}`;

/**
 * How to reopen a session in the terminal: local Claude Code sessions, and cloud sessions whose
 * transcript is on this machine too (Remote Control, teleport; see twins.ts), resume from there.
 */
export const resumeFor = (s: { source: string; external_id: string; local_id?: string | null }) =>
  s.source === "local" ? `claude --resume ${s.external_id}` : s.local_id ? `claude --resume ${s.local_id}` : null;
