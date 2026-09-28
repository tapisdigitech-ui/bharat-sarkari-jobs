import Link from "next/link";
export function EmptyState({ title, body, actionHref, actionLabel }: { title: string; body?: string; actionHref?: string; actionLabel?: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-ink-muted">{body}</p>}
      {actionHref && <Link href={actionHref} className="btn btn-outline mt-4">{actionLabel}</Link>}
    </div>
  );
}
