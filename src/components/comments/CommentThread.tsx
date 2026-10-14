"use client";

import { useEffect, useState, useTransition } from "react";
import { addCommentAction, deleteCommentAction, editCommentAction, restoreCommentAction } from "@/app/_actions/comments";
import type { CommentEntity, CommentRow } from "@/lib/comments";
import { useToast } from "../ui/Toaster";
import { Ago } from "../ui/Ago";

const URL_RE = /(https?:\/\/[^\s)]+)/g;

/** Plain text with links made clickable. */
function Body({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="font-semibold text-orange-700 underline decoration-orange-300 hover:decoration-orange-700">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </p>
  );
}

function Comment({ c, onChanged, onDeleted }: { c: CommentRow; onChanged: (c: CommentRow) => void; onDeleted: (c: CommentRow) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const edited = c.updated_at && Date.parse(c.updated_at) - Date.parse(c.created_at) > 2000;

  return (
    <li className="group flex gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-sm" aria-hidden>
        👤
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-white px-3 py-2 ring-1 ring-black/5">
        <div className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold text-zinc-400">
          <span className="text-zinc-600">You</span>
          <span title={new Date(c.created_at).toLocaleString()}><Ago iso={c.created_at} /></span>
          {edited ? <span>· edited</span> : null}
          <span className="ml-auto flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" onClick={() => setEditing(true)} className="rounded px-1.5 hover:bg-zinc-100 hover:text-zinc-700">
              Edit
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteCommentAction(c.id);
                  if (!r.ok) {
                    toast({ message: r.message, tone: "error" });
                    return;
                  }
                  onDeleted(c);
                  toast({
                    message: "Comment deleted.",
                    tone: "success",
                    action: r.comment
                      ? {
                          label: "Undo",
                          run: async () => {
                            const back = await restoreCommentAction(r.comment!);
                            if (back.ok && back.comment) onChanged(back.comment);
                            toast({ message: back.ok ? "Comment restored." : back.message, tone: back.ok ? "info" : "error" });
                          },
                        }
                      : undefined,
                  });
                })
              }
              className="rounded px-1.5 hover:bg-rose-50 hover:text-rose-600"
            >
              Delete
            </button>
          </span>
        </div>
        {editing ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await editCommentAction(c.id, draft);
                if (!r.ok || !r.comment) {
                  toast({ message: r.message, tone: "error" });
                  return;
                }
                onChanged(r.comment);
                setEditing(false);
              });
            }}
          >
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(c.body);
                  setEditing(false);
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={3}
              aria-label="Edit comment"
              className="w-full resize-y rounded-xl border-0 bg-zinc-50 px-3 py-2 text-sm ring-1 ring-black/10 focus:ring-2 focus:ring-amber-300"
            />
            <div className="flex gap-2">
              <button disabled={pending} className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-paper disabled:opacity-50">
                Save
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <Body text={c.body} />
        )}
      </div>
    </li>
  );
}

/** Notes and decisions on anything: a session, goal, project, company, team or person. */
export function CommentThread({
  entity,
  entityId,
  initial,
  title = "💬 Comments",
  placeholder = "Add a note, a decision, a link…",
}: {
  entity: CommentEntity;
  entityId: string;
  initial: CommentRow[];
  title?: string;
  placeholder?: string;
}) {
  const [comments, setComments] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const { toast } = useToast();

  useEffect(() => setComments(initial), [initial]);

  const upsert = (c: CommentRow) =>
    setComments((all) => (all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c].sort((a, b) => a.created_at.localeCompare(b.created_at))));

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    start(async () => {
      const r = await addCommentAction(entity, entityId, body);
      if (!r.ok || !r.comment) {
        toast({ message: r.message, tone: "error" });
        return;
      }
      upsert(r.comment);
      setDraft("");
    });
  };

  return (
    <section className="space-y-3" id="comments">
      <h2 className="font-display text-xl font-bold">
        {title} {comments.length ? <span className="text-sm font-semibold text-zinc-400">· {comments.length}</span> : null}
      </h2>
      {comments.length ? (
        <ul className="space-y-2">
          {comments.map((c) => (
            <Comment key={c.id} c={c} onChanged={upsert} onDeleted={(gone) => setComments((all) => all.filter((x) => x.id !== gone.id))} />
          ))}
        </ul>
      ) : null}
      <form
        className="flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-sm" aria-hidden>
          👤
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            rows={draft.includes("\n") || draft.length > 80 ? 4 : 2}
            placeholder={placeholder}
            aria-label="New comment"
            className="w-full resize-y rounded-2xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-black/10 focus:ring-2 focus:ring-amber-300"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">⌘/Ctrl + Enter to post</span>
            <button disabled={pending || !draft.trim()} className="rounded-xl bg-ink px-4 py-1.5 text-sm font-bold text-paper disabled:opacity-40">
              {pending ? "Posting…" : "Comment"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
