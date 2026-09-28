import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/config/site";
import { countJobs, districtContentCounts, facetCounts, sitemapJobs } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import { sitemapRecruitments } from "@/lib/data/gov";
import { sitemapExamHubs } from "@/lib/data/gov-exams";
import { sitemapGov } from "@/lib/data/gov-items";
import { infoPages } from "@/config/pages";

/**
 * Only URLs that deserve indexing are listed:
 *  - landing pages that currently have at least one open job (or, for the newer content types, at least one
 *    live record — a Recruitment, Exam, Admit Card, Result or Answer Key detail page is only ever listed once
 *    it is published),
 *  - real (non-demo) open job pages, recruitments, exam hubs, admit cards, results and answer keys.
 * Empty landing pages are omitted so we never ship thin pages to search engines. Filtered/search URLs
 * (?q=, ?organization=, /search, staff previews) are never listed — each of those already sets noindex itself.
 */
// Rendered on every request (Phase 3.6): an unpublished or archived record must leave the sitemap immediately, including when
// its status changes outside the admin console (expiry cron, database). A crawler fetches the sitemap rarely; the queries are
// bounded (≤45,000 rows per type) and the public-route rate limit applies.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entry = (path: string, priority = 0.6, changeFrequency: "daily" | "weekly" | "monthly" = "weekly"): MetadataRoute.Sitemap[number] => ({ url: absoluteUrl(path), lastModified: now, changeFrequency, priority });
  const dated = (path: string, updatedAt: string, priority = 0.6): MetadataRoute.Sitemap[number] => ({ url: absoluteUrl(path), lastModified: new Date(updatedAt), changeFrequency: "daily", priority });

  const [{ states, departments, qualifications }, districtN, stateN, deptN, qualN, jobs, recruitments, exams, admitCards, results, answerKeys, centralN] = await Promise.all([
    getRef(), districtContentCounts(),
    facetCounts("state"), facetCounts("department"), facetCounts("qualification"),
    sitemapJobs(),
    sitemapRecruitments(),
    sitemapExamHubs(),
    sitemapGov("admit_card"), sitemapGov("result"), sitemapGov("answer_key"),
    countJobs({ level: "central" }),
  ]);

  return [
    entry("/", 1, "daily"), entry("/jobs", 0.9, "daily"), entry("/admit-card", 0.8, "daily"), entry("/results", 0.8, "daily"), entry("/answer-key", 0.8, "daily"),
    entry("/exam-calendar", 0.8, "daily"), entry("/state", 0.7), entry("/department", 0.7), entry("/qualification", 0.7), entry("/exams", 0.6), entry("/preparation", 0.5, "monthly"),
    ...(centralN ? [entry("/central-jobs", 0.8, "daily")] : []),
    ...states.filter((s) => (stateN[s.slug] ?? 0) > 0).map((s) => entry(`/state/${s.slug}/jobs`, 0.7)),
    ...departments.filter((d) => (deptN[d.slug] ?? 0) > 0).map((d) => entry(`/department/${d.slug}`, 0.7)),
    ...qualifications.filter((q) => (qualN[q.slug] ?? 0) > 0).map((q) => entry(`/qualification/${q.slug}`, 0.7)),
    // District pages only when they have content: importing an official district list never creates thin indexable pages.
    ...districtN.filter((d) => d.n > 0).map((d) => entry(`/state/${d.state}/district/${d.district}`, 0.6)),
    ...jobs.map((j) => dated(`/jobs/${j.slug}`, j.updatedAt, 0.8)),
    ...recruitments.map((r) => dated(`/recruitment/${r.slug}`, r.updatedAt, 0.6)),
    ...exams.map((e) => dated(`/exams/${e.slug}`, e.updatedAt, 0.6)),
    ...admitCards.map((a) => dated(`/admit-card/${a.slug}`, a.updatedAt, 0.6)),
    ...results.map((r) => dated(`/results/${r.slug}`, r.updatedAt, 0.6)),
    ...answerKeys.map((a) => dated(`/answer-key/${a.slug}`, a.updatedAt, 0.6)),
    ...infoPages.map((p) => entry(`/${p.slug}`, 0.3, "monthly")),
  ];
}
