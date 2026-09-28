"use client";
import { useActionState } from "react";
import { deleteContentAction, transitionContentAction, type ContentWorkflowState } from "@/app/admin/(console)/[ref]/content-actions";

const TONE: Record<string, string> = { published: "btn-accent", updated: "btn-accent", review: "btn-primary", draft: "btn-outline", expired: "btn-outline", archived: "btn-outline" };

export function ContentWorkflowPanel({ kind, label, id, status, transitions, canDelete, reviewComment }: { kind: string; label: string; id: string; status: string; transitions: { to: string; label: string }[]; canDelete: boolean; reviewComment?: string }) {
  const [state, action, pending] = useActionState<ContentWorkflowState, FormData>(transitionContentAction, {});
  const [delState, delAction, delPending] = useActionState<ContentWorkflowState, FormData>(deleteContentAction, {});
  return (
    <section aria-labelledby="wf-h" className="card p-4 md:p-5">
      <h2 id="wf-h" className="text-lg font-bold">Workflow</h2>
      {reviewComment && <p className="mt-2 rounded-md bg-canvas p-2 text-sm"><strong>Last review note:</strong> {reviewComment}</p>}
      {transitions.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Your role has no workflow actions for this record in its current state.</p> : (
        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="_kind" value={kind} /><input type="hidden" name="id" value={id} />
          <div><label htmlFor="wf-comment" className="mb-1 block text-sm font-semibold">Note (optional, staff only)</label>
            <textarea id="wf-comment" name="comment" rows={2} maxLength={1000} className="input min-h-16 py-2" placeholder="Reason for the change, e.g. what to fix" /></div>
          <div className="flex flex-wrap gap-2">{transitions.map((t) => <button key={t.to + t.label} type="submit" name="to" value={t.to} disabled={pending} className={`btn ${TONE[t.to] ?? "btn-outline"} disabled:opacity-60`}>{t.label}</button>)}</div>
          {state.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{state.error}</p>}
          {state.ok && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{state.message}</p>}
        </form>
      )}
      {canDelete && (status === "draft" || status === "archived") && (
        <details className="mt-4 rounded-md border border-danger-600/30 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-danger-700">Danger zone: delete this {label.toLowerCase()}</summary>
          <form action={delAction} className="mt-3 space-y-2">
            <input type="hidden" name="_kind" value={kind} /><input type="hidden" name="id" value={id} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" className="mt-1 size-4" /> <span>I understand this permanently deletes the record. (Records that others link to cannot be deleted — archive them instead.)</span></label>
            <button type="submit" disabled={delPending} className="btn btn-sm border border-danger-600 bg-white text-danger-700 hover:bg-danger-50 disabled:opacity-60">Delete {label.toLowerCase()}</button>
            {delState.error && <p role="alert" className="text-sm text-danger-700">{delState.error}</p>}
          </form>
        </details>
      )}
    </section>
  );
}
