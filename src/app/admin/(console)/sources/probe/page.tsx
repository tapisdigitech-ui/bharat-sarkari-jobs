import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/admin/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTimeIST } from "@/lib/admin/format";
import { loadSourceTable, probeRuntime } from "@/lib/ingestion/probe";
import { isDeployment, markdownTable, type State } from "@/lib/ingestion/probe-report";
import { probeSourcesAction } from "../actions";

export const metadata: Metadata = { title: "Server-side source probe" };
export const dynamic = "force-dynamic";
export const maxDuration = 300;   // the probe action runs from this page (≤ 10 sources, 240 s budget)
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TONE: Record<State, string> = {
  PASS: "bg-success-50 text-success-700", "PASS WITH ADAPTER": "bg-success-50 text-success-700", MANUAL: "bg-warning-50 text-warning-700",
  BLOCKED: "bg-danger-50 text-danger-700", FAILED: "bg-danger-50 text-danger-700", UNKNOWN: "bg-canvas text-ink-muted",
};
const Chip = ({ s }: { s: State }) => <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${TONE[s]}`}>{s}</span>;

export default async function ProbePage({ searchParams }: Props) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const done = typeof sp.done === "string" ? sp.done.slice(0, 500) : "";
  const db = await createSupabaseServerClient();
  let rows: Awaited<ReturnType<typeof loadSourceTable>> = []; let err = "";
  try { rows = await loadSourceTable(db); } catch (e) { err = (e as Error).message.slice(0, 200); }
  const manage = can(staff.role, "source:manage");
  const runtime = probeRuntime();
  const md = markdownTable(rows.map((r) => r.row));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm"><Link href="/admin/sources" className="text-brand-700 underline">← Source registry</Link></p>
        <h1 className="mt-1 text-2xl font-extrabold">Server-side source probe</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Can <strong>this server</strong> reach each official source? One robots.txt request, the listing page and the first notice per source. Nothing is queued for review and nothing is published.
          A robots refusal, HTTP 401/403/429, a CAPTCHA or an anti-bot page is recorded as <strong>BLOCKED</strong> and is never worked around — those sources are operated manually.
        </p>
        <p className="mt-2 text-sm">This page is running on: <strong data-testid="probe-runtime">{runtime}</strong>
          {!isDeployment(runtime) && <span className="ml-2 rounded bg-warning-50 px-1.5 py-0.5 text-xs font-semibold text-warning-700">not a deployment — results here do not answer the server-side question</span>}</p>
      </div>
      {done && <p role="status" className="rounded-md border border-line bg-brand-50 px-3 py-2 text-sm">{done}</p>}
      {err && <p role="alert" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">Could not load probes: {err}</p>}
      {manage && (
        <form action={probeSourcesAction} className="card flex flex-wrap items-end gap-3 p-3">
          <div><label htmlFor="limit" className="mb-1 block text-xs font-semibold text-ink-muted">Sources per run</label>
            <select id="limit" name="limit" defaultValue="4" className="input">{[1, 2, 4, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          <button className="btn btn-accent">Probe next sources</button>
          <p className="text-xs text-ink-muted">Least-recently probed first; sources are fetched one after another with a polite delay. Up to ~4 minutes.</p>
        </form>
      )}
      <div className="table-wrap card" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Source-by-source probe results</caption>
          <thead className="border-b border-line bg-brand-50 text-xs uppercase tracking-wide text-ink-muted"><tr>
            {["Source", "Server access", "Robots", "Discovery", "Extraction", "Review", "Publish", "Last probe", "Notes"].map((h) => <th key={h} scope="col" className="px-3 py-2">{h}</th>)}
            <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-ink-muted">No official sources registered.</td></tr>}
            {rows.map(({ id, domain, probe, row }) => (
              <tr key={id} data-testid="probe-row" className="align-top">
                <td className="px-3 py-2"><Link href={`/admin/sources/${id}`} className="font-semibold text-brand-700 underline">{row.source}</Link><div className="text-xs text-ink-muted">{domain}</div></td>
                <td className="px-3 py-2"><Chip s={row.server} /></td><td className="px-3 py-2"><Chip s={row.robots} /></td>
                <td className="px-3 py-2"><Chip s={row.discovery} />{probe?.discovered != null && <div className="text-xs text-ink-muted">{probe.discovered} found</div>}</td>
                <td className="px-3 py-2"><Chip s={row.extraction} /></td><td className="px-3 py-2"><Chip s={row.review} /></td><td className="px-3 py-2"><Chip s={row.publish} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{probe?.probed_at ? formatDateTimeIST(probe.probed_at) : "—"}</td>
                <td className="min-w-[24rem] px-3 py-2 text-xs text-ink-muted">{row.notes}</td>
                <td className="px-3 py-2">{manage && <form action={probeSourcesAction}><input type="hidden" name="id" value={id} /><button className="btn btn-outline btn-sm whitespace-nowrap">Probe</button></form>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Markdown (for the Phase 3.7 report)</h2>
          <a href="/admin/sources/probe/table.md" className="btn btn-outline btn-sm" download="source-table.md">Download .md</a></div>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre rounded bg-canvas p-3 text-xs" tabIndex={0}>{md}</pre>
      </section>
    </div>
  );
}
