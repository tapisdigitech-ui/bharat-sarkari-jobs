/**
 * Site-wide search (Phase 2B · Step 10): one query fanned out across every public content type —
 * Jobs, Recruitments, Exams, Admit Cards, Results, Answer Keys and Organizations — so a reader typing
 * "SSC" or "police constable" finds whichever of these actually matches, each labelled by type.
 * Every branch only ever returns records the public site already shows (published/updated/expired via
 * each type's own repository function), so search can never leak a draft. Not AI search: plain substring
 * matching on titles/names, same as every existing list-page filter in this codebase. Written once for both data
 * sources: each branch goes through the data port, which answers empty for types a source does not hold.
 */
import "server-only";
import { listJobs } from "@/lib/data";
import { listRecruitments } from "@/lib/data/gov";
import { listExamHubs } from "@/lib/data/gov-exams";
import { listGov } from "@/lib/data/gov-items";
import { listOrganizations } from "@/lib/data/ref";
import { govPaths, type GovKind } from "@/lib/gov-types";

export type SearchKind = "job" | "recruitment" | "exam" | GovKind | "organization";
export interface SearchResult { kind: SearchKind; label: string; title: string; subtitle?: string; href: string }
export interface SearchSection { kind: SearchKind; label: string; plural: string; items: SearchResult[] }

const LABEL: Record<SearchKind, { label: string; plural: string }> = {
  job: { label: "Job", plural: "Jobs" },
  recruitment: { label: "Recruitment", plural: "Recruitments" },
  exam: { label: "Exam", plural: "Exams" },
  admit_card: { label: "Admit Card", plural: "Admit Cards" },
  result: { label: "Result", plural: "Results" },
  answer_key: { label: "Answer Key", plural: "Answer Keys" },
  organization: { label: "Organization", plural: "Organizations" },
};

/** A query too short or empty never runs a scan of every table — the caller shows a "type to search" prompt instead. */
export function searchable(q: string | undefined): q is string {
  return !!q && q.trim().length >= 2;
}

/** Fan out one query across every content type, each capped to `limitPerType`. Never throws on an empty/short query. */
export async function globalSearch(q: string, limitPerType = 6): Promise<SearchSection[]> {
  if (!searchable(q)) return [];
  const [jobs, recruitments, exams, admitCards, results, answerKeys, orgs] = await Promise.all([
    listJobs({ q }, { pageSize: limitPerType }),
    listRecruitments({ q, limit: limitPerType }),
    listExamHubs({ q }, { pageSize: limitPerType }),
    listGov("admit_card", { q }, { pageSize: limitPerType }),
    listGov("result", { q }, { pageSize: limitPerType }),
    listGov("answer_key", { q }, { pageSize: limitPerType }),
    listOrganizations({ activeOnly: true }),
  ]);
  const term = q.trim().toLowerCase();
  const orgMatches = orgs.filter((o) => o.name.toLowerCase().includes(term) || o.shortName?.toLowerCase().includes(term)).slice(0, limitPerType);

  const sections: SearchSection[] = [
    section("job", jobs.jobs.map((j) => ({ kind: "job", ...LABEL.job, title: j.title, subtitle: j.organization, href: `/jobs/${j.slug}` }))),
    section("recruitment", recruitments.map((r) => ({ kind: "recruitment", ...LABEL.recruitment, title: r.title, subtitle: r.organization, href: `/recruitment/${r.slug}` }))),
    section("exam", exams.items.map((e) => ({ kind: "exam", ...LABEL.exam, title: e.name, subtitle: e.organization, href: `/exams/${e.slug}` }))),
    section("admit_card", admitCards.items.map((i) => ({ kind: "admit_card", ...LABEL.admit_card, title: i.title, subtitle: i.organization, href: govPaths.admit_card.detail(i.slug) }))),
    section("result", results.items.map((i) => ({ kind: "result", ...LABEL.result, title: i.title, subtitle: i.organization, href: govPaths.result.detail(i.slug) }))),
    section("answer_key", answerKeys.items.map((i) => ({ kind: "answer_key", ...LABEL.answer_key, title: i.title, subtitle: i.organization, href: govPaths.answer_key.detail(i.slug) }))),
    section("organization", orgMatches.map((o) => ({ kind: "organization", ...LABEL.organization, title: o.name, subtitle: undefined, href: `/jobs?organization=${o.slug}` }))),
  ];
  return sections.filter((s) => s.items.length > 0);
}

function section(kind: SearchKind, items: SearchResult[]): SearchSection {
  return { kind, ...LABEL[kind], items };
}
