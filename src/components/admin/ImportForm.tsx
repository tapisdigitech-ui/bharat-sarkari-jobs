"use client";
import { useActionState } from "react";
import { importCsvAction, type ImportState } from "@/app/admin/(console)/import/actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importCsvAction, {});
  const rows = state.rows ?? [];
  const good = rows.filter((r) => r.ok).length;
  return (
    <div className="space-y-4">
      <form key={`f${state.nonce ?? 0}`} action={action} className="card space-y-3 p-4" aria-label="CSV import">
        {state.error && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm font-semibold text-danger-700">{state.error}</p>}
        {state.ok && <p role="status" className="rounded-md border border-success-700/30 bg-success-50 px-3 py-2 text-sm text-success-700">{state.ok}</p>}
        <div><label htmlFor="csv-file" className="mb-1 block text-sm font-semibold">CSV file</label><input id="csv-file" name="file" type="file" accept=".csv,text/csv" className="block text-sm" /></div>
        <div><label htmlFor="csv-text" className="mb-1 block text-sm font-semibold">…or paste the CSV</label>
          <textarea id="csv-text" name="csv" rows={8} defaultValue={state.csv ?? ""} className="input min-h-40 py-2 font-mono text-xs" spellCheck={false} /></div>
        <div className="flex flex-wrap gap-2">
          <button name="intent" value="preview" className="btn btn-outline" disabled={pending}>{pending ? "Checking…" : "Validate & preview"}</button>
          {rows.length > 0 && <button name="intent" value="import" className="btn btn-primary" disabled={pending || good === 0}>Send {good} valid row(s) to the review queue</button>}
        </div>
      </form>
      {rows.length > 0 && (
        <section aria-labelledby="pv-h" className="card p-4">
          <h2 id="pv-h" className="font-bold">Preview — {good} valid, {rows.length - good} with errors</h2>
          <div className="table-wrap mt-2" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="w-full text-left text-sm"><caption className="sr-only">Rows in the file</caption>
            <thead className="border-b border-line text-xs uppercase text-ink-muted"><tr><th scope="col" className="px-2 py-1">Line</th><th scope="col" className="px-2 py-1">Title</th><th scope="col" className="px-2 py-1">Last date</th><th scope="col" className="px-2 py-1">Result</th></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((r) => (
              <tr key={r.line} data-testid="import-row" data-ok={r.ok ? "1" : "0"}><td className="px-2 py-1">{r.line}</td><td className="px-2 py-1">{r.title || "—"}</td><td className="px-2 py-1">{String(r.extracted.last_date ?? "—")}</td>
                <td className="px-2 py-1">{r.ok ? <span className="text-success-700">OK{r.warnings.length ? ` — ${r.warnings.join("; ")}` : ""}</span> : <span className="text-danger-700">{r.errors.join("; ")}</span>}</td></tr>))}</tbody></table></div>
        </section>
      )}
    </div>
  );
}
