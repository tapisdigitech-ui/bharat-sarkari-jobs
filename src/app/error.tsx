"use client";
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page py-16 text-center">
      <h1 className="text-2xl font-extrabold">Something went wrong</h1>
      <p className="mx-auto mt-2 max-w-md text-ink-muted">We couldn&rsquo;t load this page. Please try again in a moment.</p>
      <button type="button" onClick={reset} className="btn btn-primary mt-5">Try again</button>
    </div>
  );
}
