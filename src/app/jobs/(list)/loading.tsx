/** Skeleton shown while a filtered job list streams in. Scoped to the /jobs list only (detail pages must return a real 404 status). */
export default function Loading() {
  return (
    <div className="container-page py-6 md:py-8" role="status" aria-live="polite" aria-label="Loading jobs">
      <div className="h-8 w-64 max-w-full animate-pulse rounded bg-line" />
      <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-line" />
      <ul className="mt-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="card space-y-2 p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-line" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading jobs…</span>
    </div>
  );
}
