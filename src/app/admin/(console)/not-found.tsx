import Link from "next/link";

export default function AdminNotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-xl font-extrabold">Not found</h1>
      <p className="mt-2 text-sm text-ink-muted">That record does not exist, or your role cannot see it.</p>
      <Link href="/admin/jobs" className="btn btn-outline mt-4">Back to jobs</Link>
    </div>
  );
}
