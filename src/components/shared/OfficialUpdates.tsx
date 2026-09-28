import { OFFICIAL_UPDATE_LABEL, type OfficialUpdate } from "@/lib/gov-types";
import { formatDate } from "@/lib/dates";
import { fieldLabel } from "@/lib/ingestion/review-fields";
import { linkHost } from "@/lib/trust";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "not stated" : Array.isArray(v) ? v.join(", ") : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDate(String(v)) : String(v));

/**
 * The record's history of OFFICIAL updates, oldest first: the original notice, then every corrigendum, addendum,
 * postponement or extension the recruiting body issued. Nothing is erased — readers can see what changed and why.
 */
export function OfficialUpdates({ updates, original }: { updates: OfficialUpdate[]; original?: { label: string; date?: string | null; url?: string | null } }) {
  if (!updates.length) return null;
  return (
    <section aria-labelledby="updates-h" className="rounded-lg border border-line bg-white p-4" data-testid="official-updates">
      <h2 id="updates-h" className="text-base font-bold text-brand-900">Official updates to this notice</h2>
      <p className="mt-1 text-sm text-ink-soft">The recruiting body changed the original information. Details on this page already reflect the latest official update.</p>
      <ol className="mt-3 space-y-3 border-l-2 border-brand-100 pl-4">
        {original && (
          <li><p className="text-sm font-semibold">{original.label}{original.date ? <span className="font-normal text-ink-muted"> · {formatDate(original.date)}</span> : null}</p>
            {original.url && <a href={original.url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-700 underline">Original official notice</a>}</li>
        )}
        {updates.map((u) => (
          <li key={u.id}>
            <p className="text-sm"><span className="badge badge-updated mr-1">{OFFICIAL_UPDATE_LABEL[u.type]}</span><span className="font-semibold">{u.title}</span>{u.issuedOn ? <span className="text-ink-muted"> · {formatDate(u.issuedOn)}</span> : null}</p>
            {u.summary && <p className="mt-1 text-sm text-ink-soft">{u.summary}</p>}
            {Object.keys(u.changes).length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-sm">{Object.entries(u.changes).map(([k, c]) => <li key={k}>{fieldLabel(k)}: <span className="line-through decoration-ink-muted">{show(c.from)}</span> → <strong>{show(c.to)}</strong></li>)}</ul>
            )}
            {u.officialUrl && <p className="mt-1 text-sm"><a href={u.officialUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">Read the official {OFFICIAL_UPDATE_LABEL[u.type].toLowerCase()}</a> <span className="text-xs text-ink-muted">({linkHost(u.officialUrl)})</span></p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
