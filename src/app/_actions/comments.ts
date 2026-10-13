"use server";

import { revalidatePath } from "next/cache";
import { addComment, deleteComment, editComment, restoreComment, type CommentEntity, type CommentResult, type CommentRow } from "@/lib/comments";

export type { CommentResult } from "@/lib/comments";

async function refreshing(work: Promise<CommentResult>): Promise<CommentResult> {
  const r = await work;
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function addCommentAction(type: CommentEntity, id: string, body: string): Promise<CommentResult> {
  return refreshing(addComment(type, id, body));
}

export async function editCommentAction(commentId: string, body: string): Promise<CommentResult> {
  return refreshing(editComment(commentId, body));
}

/** Delete a comment; returns it so the client can offer Undo (re-adding it). */
export async function deleteCommentAction(commentId: string): Promise<CommentResult> {
  return refreshing(deleteComment(commentId));
}

/** Put a deleted comment back exactly as it was (Undo). */
export async function restoreCommentAction(comment: CommentRow): Promise<CommentResult> {
  return refreshing(restoreComment(comment));
}
