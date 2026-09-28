import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/staff";
import { ImportForm } from "@/components/admin/ImportForm";
import { CSV_COLUMNS, MAX_ROWS } from "@/lib/ingestion/csv";

export const metadata: Metadata = { title: "CSV import" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireStaff("ingestion:run");
  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-extrabold">CSV import</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">Bulk-add job records prepared from official notices. Every row is validated against the reference data (organizations, states, qualifications, categories), previewed, and then sent to the <strong>review queue</strong> — imports never create or publish content directly.</p></div>
      <section className="card p-4 text-sm" aria-labelledby="cols-h">
        <h2 id="cols-h" className="font-bold">Columns</h2>
        <p className="mt-1"><strong>Required:</strong> <code>{CSV_COLUMNS.required.join(", ")}</code></p>
        <p className="mt-1"><strong>Optional:</strong> <code>{CSV_COLUMNS.optional.join(", ")}</code></p>
        <p className="mt-1 text-ink-muted">Dates as YYYY-MM-DD or DD/MM/YYYY. <code>state</code> is a state slug (e.g. <code>uttar-pradesh</code>) or <code>all-india</code>. <code>qualifications</code> / <code>categories</code>: slugs separated by <code>;</code>. The organization must already exist. Up to {MAX_ROWS} rows.</p>
      </section>
      <ImportForm />
    </div>
  );
}
