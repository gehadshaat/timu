/** Canonical page URLs for every entity, so names can link anywhere they appear. */
export const companyHref = (slug: string) => `/companies/${slug}`;
export const projectHref = (slug: string) => `/projects/${slug}`;
export const teamHref = (id: string) => `/teams/${id}`;
export const personHref = (id: string) => `/people/${id}`;
export const goalHref = (id: string) => `/goals/${id}`;

/** How to reopen a session where it lives: local Claude Code sessions resume from the terminal. */
export const resumeFor = (s: { source: string; external_id: string }) => (s.source === "local" ? `claude --resume ${s.external_id}` : null);
