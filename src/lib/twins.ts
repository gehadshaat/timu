import "server-only";
import { linkSessionArtifacts } from "./artifacts";
import { all, get, now, run, tx, update } from "./db";
import type { NormalizedSession } from "./types";

/**
 * One conversation, one row.
 *
 * A Claude Code session you run in the terminal with Remote Control is also a claude.ai/code session,
 * and a cloud session you teleport to the terminal leaves a transcript behind: the same conversation
 * reaches Timu as a local transcript *and* a cloud session. The transcript names its cloud session
 * (`cloudId`, see sources/local.ts), and Timu keeps the cloud row (its link opens anywhere, and routines
 * point at it), folding the transcript into it: the row remembers the transcript (`local_id`) so it can
 * be resumed in the terminal too, and takes the artifacts the transcript published.
 *
 * Either side can arrive first. A transcript whose cloud session isn't imported yet gets a local row
 * that carries `cloud_id`; the import that brings the cloud session merges that row into it. Only one
 * transcript folds into a cloud session (the first; a fork of it stays a session of its own).
 */

interface Twin {
  id: string;
  external_id: string;
  title: string;
  title_locked: boolean;
  project_id: string | null;
  team_id: string | null;
  agent_id: string | null;
  goal_id: string | null;
  summary: string | null;
  classified_at: string | null;
  archived: boolean;
  status_override: string | null;
  local_id: string | null;
  started_at: string | null;
}

const TWIN_COLUMNS =
  "id, external_id, title, title_locked, project_id, team_id, agent_id, goal_id, summary, classified_at, archived, status_override, local_id, started_at";

const filed = (r: Twin) => !!(r.project_id || r.team_id || r.agent_id || r.goal_id);
/** Oldest first, so a session's own transcript claims its cloud row before a fork copied from it. */
const byStart = (a: string | null, b: string | null) => (a ?? "￿").localeCompare(b ?? "￿");

/**
 * Merge a local row into the cloud row it mirrors and delete it. What you did to the local row carries
 * over where the cloud row has nothing of its own: where it's filed, a title you gave it, a status you
 * set, its comments, asks and artifacts.
 */
function mergeInto(local: Twin, cloud: Twin): void {
  tx(() => {
    const patch: Record<string, unknown> = { local_id: local.external_id };
    // Archived only if you archived both: archiving one of the pair was hiding the duplicate.
    const unarchived = cloud.archived && !local.archived;
    if (unarchived) patch.archived = false;
    if (filed(local) && (!filed(cloud) || unarchived)) {
      Object.assign(patch, {
        project_id: local.project_id,
        team_id: local.team_id,
        agent_id: local.agent_id,
        goal_id: local.goal_id,
        summary: local.summary ?? cloud.summary,
        classified_at: local.classified_at,
      });
    } else if (unarchived && !filed(cloud)) {
      // Back from the archive with nowhere to be: let the organiser file it.
      patch.classified_at = null;
    }
    if (local.title_locked && !cloud.title_locked) Object.assign(patch, { title: local.title, title_locked: true });
    if (local.status_override && !cloud.status_override) patch.status_override = local.status_override;
    update("sessions", patch, "id = ?", cloud.id);

    // One open ask per session: the local row's open ask moves over only if the cloud row has none.
    if (get("select id from tasks where session_id = ? and status <> 'done'", cloud.id)) {
      run("update tasks set status = 'done', resolved_at = ? where session_id = ? and status <> 'done'", now(), local.id);
    }
    run("update tasks set session_id = ? where session_id = ?", cloud.id, local.id);
    run("update comments set entity_id = ? where entity_type = 'session' and entity_id = ?", cloud.id, local.id);
    run("update artifacts set session_id = ? where session_id = ?", cloud.id, local.id);
    run("delete from sessions where id = ?", local.id);
  });
}

/**
 * Before local transcripts are saved: fold each one whose cloud session Timu already has into that
 * session's row, and return the rest (which get local rows of their own). Writes only what changed, so a
 * sync that reads an unchanged transcript changes nothing. `folded` counts the cloud rows it changed.
 */
export function foldLocalTwins(sessions: NormalizedSession[]): { rest: NormalizedSession[]; folded: number } {
  const claimants = sessions.filter((s) => s.cloudId).sort((a, b) => byStart(a.startedAt, b.startedAt));
  if (!claimants.length) return { rest: sessions, folded: 0 };

  const clouds = new Map(
    all<Twin>(
      `select ${TWIN_COLUMNS} from sessions where source = 'cloud' and external_id in (select value from json_each(?))`,
      [...new Set(claimants.map((s) => s.cloudId!))],
    ).map((c) => [c.external_id, c]),
  );
  const locals = new Map(
    all<Twin>(
      `select ${TWIN_COLUMNS} from sessions where source = 'local' and external_id in (select value from json_each(?))`,
      claimants.map((s) => s.externalId),
    ).map((l) => [l.external_id, l]),
  );

  const absorbed = new Set<NormalizedSession>();
  let folded = 0;
  for (const s of claimants) {
    const cloud = clouds.get(s.cloudId!);
    // Not imported yet (or no cloud access): the transcript keeps a row of its own until it is.
    if (!cloud) continue;
    // Another transcript already folded into this session: this one is a fork, a session of its own.
    if (cloud.local_id && cloud.local_id !== s.externalId) continue;
    absorbed.add(s);

    let changed = false;
    const local = locals.get(s.externalId);
    if (local) {
      mergeInto(local, cloud);
      changed = true;
    } else if (cloud.local_id !== s.externalId) {
      update("sessions", { local_id: s.externalId }, "id = ?", cloud.id);
      changed = true;
    }
    cloud.local_id = s.externalId;

    // The transcript knows which artifacts the session published; the cloud record rarely does.
    const artifacts = Array.isArray(s.raw.artifacts) ? (s.raw.artifacts as { id: string; url: string; title?: string | null }[]) : [];
    const linked = all<{ id: string }>("select id from artifacts where session_id = ?", cloud.id).map((a) => a.id);
    const ids = artifacts.map((a) => a.id);
    if (linked.length !== new Set(ids).size || ids.some((id) => !linked.includes(id))) {
      linkSessionArtifacts([{ sessionId: cloud.id, artifacts }]);
      changed = true;
    }
    if (changed) folded++;
  }
  return { rest: sessions.filter((s) => !absorbed.has(s)), folded };
}

/**
 * After cloud sessions are saved: merge into them the local rows that were waiting for them (a
 * transcript imported before its cloud session was). Returns how many rows it merged.
 */
export function absorbWaitingTwins(cloudExternalIds: string[]): number {
  // Few rows ever wait (cloud_id is set only until the cloud session arrives): read them all.
  const waiting = all<Twin & { cloud_id: string }>(
    `select ${TWIN_COLUMNS}, cloud_id from sessions where cloud_id is not null and source = 'local'`,
  );
  if (!waiting.length) return 0;
  const wanted = new Set(cloudExternalIds);
  const ours = waiting.filter((l) => wanted.has(l.cloud_id)).sort((a, b) => byStart(a.started_at, b.started_at));
  if (!ours.length) return 0;

  const clouds = new Map(
    all<Twin>(
      `select ${TWIN_COLUMNS} from sessions where source = 'cloud' and external_id in (select value from json_each(?))`,
      [...new Set(ours.map((l) => l.cloud_id))],
    ).map((c) => [c.external_id, c]),
  );
  let merged = 0;
  for (const local of ours) {
    const cloud = clouds.get(local.cloud_id);
    if (!cloud || (cloud.local_id && cloud.local_id !== local.external_id)) continue;
    mergeInto(local, cloud);
    cloud.local_id = local.external_id;
    merged++;
  }
  return merged;
}
