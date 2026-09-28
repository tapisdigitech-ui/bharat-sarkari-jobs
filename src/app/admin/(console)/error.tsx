"use client";
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-xl font-extrabold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">The page could not be loaded. Nothing was changed. If this keeps happening, check that the database is reachable and the migrations have been applied.</p>
      {error.digest && <p className="mt-2 text-xs text-ink-muted">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn btn-primary mt-4">Try again</button>
    </div>
  );
}
