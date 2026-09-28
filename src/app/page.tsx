import type { Metadata } from "next";
import Link from "next/link";
import { Hero } from "@/components/home/Hero";
import { AlertCard } from "@/components/home/AlertCard";
import { DepartmentCard, QualificationCard, StateCard, TileLink } from "@/components/home/Cards";
import { UpdatesTabs } from "@/components/home/UpdatesTabs";
import { JobCard } from "@/components/jobs/JobCard";
import { ClosingSoonList } from "@/components/jobs/ClosingSoonList";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AdSlot } from "@/components/ui/AdSlot";
import { DemoBadge } from "@/components/ui/Badge";
import { dateLabel, DateValue } from "@/components/gov/DateValue";
import { closingSoon, facetCounts, latestJobs, latestUpdates } from "@/lib/data";
import { getRef } from "@/lib/data/ref";
import { upcomingExams } from "@/lib/data/gov-calendar";
import { site } from "@/config/site";
import { buildMetadata } from "@/lib/seo/metadata";
import type { SiteUpdate, UpdateKind } from "@/lib/types";

export const revalidate = 600; // deadlines/"days left" are time-based; publish/expire also revalidate on demand

export const metadata: Metadata = {
  ...buildMetadata({ title: `${site.name} — ${site.positioning}`, description: "Find central, state and district government jobs across India. Eligibility, last dates, admit cards, results and links to the official notification.", path: "/" }),
  title: { absolute: `${site.name} — ${site.positioning}` },
};

// Popular states shown on the homepage; the full directory lives at /state.
const HOME_STATES = ["uttar-pradesh", "maharashtra", "bihar", "rajasthan", "madhya-pradesh", "delhi", "karnataka", "gujarat", "tamil-nadu", "west-bengal", "punjab", "haryana"];

export default async function HomePage() {
  const [latest, closing, updates, upcoming, stateCounts, deptCounts, qualCounts, { states, departments, qualifications }] = await Promise.all([
    latestJobs(6), closingSoon(6), latestUpdates(24), upcomingExams(4), facetCounts("state"), facetCounts("department"), facetCounts("qualification"), getRef(),
  ]);
  const anyDemo = latest.some((j) => j.isDemo);
  const homeStates = HOME_STATES.map((s) => states.find((x) => x.slug === s)).filter((x) => !!x);
  const updateGroups = { job: [], "admit-card": [], result: [], "answer-key": [], "exam-date": [], application: [], notice: [] } as Record<UpdateKind, SiteUpdate[]>;
  for (const u of updates) if (updateGroups[u.kind].length < 5) updateGroups[u.kind].push(u);

  return (
    <>
      <Hero />
      <div className="container-page space-y-10 py-8 md:space-y-14 md:py-12">
        {anyDemo && (
          <p role="note" className="rounded-lg border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">
            <DemoBadge /> <span className="ml-1">Development preview: all jobs, dates and vacancy numbers on this site are placeholder demo data, not real recruitments.</span>
          </p>
        )}

        <section aria-labelledby="quick-h">
          <SectionHeader id="quick-h" title="Quick access" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <TileLink href="/jobs" icon="flame" title="Latest Jobs" desc="Newly published" />
            <TileLink href="/jobs?closing=7&sort=closing" icon="clock" title="Closing Soon" desc="Within 7 days" tone="danger" />
            <TileLink href="/qualification/10th-pass" icon="cap" title="10th Pass" tone="accent" />
            <TileLink href="/qualification/12th-pass" icon="cap" title="12th Pass" tone="accent" />
            <TileLink href="/qualification/graduate" icon="cap" title="Graduate" tone="accent" />
            <TileLink href="/qualification/post-graduate" icon="cap" title="Post Graduate" tone="accent" />
            <TileLink href="/jobs?women=1" icon="woman" title="Women Jobs" />
            <TileLink href="/jobs?level=district" icon="pin" title="District Jobs" />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
          <section aria-labelledby="latest-h">
            <SectionHeader id="latest-h" title="Latest Government Jobs" href="/jobs" />
            <ul className="grid gap-3">{latest.map((j) => <li key={j.id}><JobCard job={j} /></li>)}</ul>
          </section>
          <div className="space-y-6">
            <section aria-labelledby="closing-h">
              <SectionHeader id="closing-h" title="Jobs Closing Soon" href="/jobs?closing=7&sort=closing" />
              <ClosingSoonList jobs={closing} />
            </section>
            <AdSlot placement="sidebar" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
          <section aria-labelledby="updates-h">
            <SectionHeader id="updates-h" title="Latest Government Updates" subtitle="Jobs, admit cards, results and answer keys" />
            <UpdatesTabs groups={updateGroups} />
          </section>
          <section aria-labelledby="upcoming-exams-h">
            <SectionHeader id="upcoming-exams-h" title="Upcoming Government Exams" href="/exam-calendar" hrefLabel="View All" />
            {upcoming.length === 0 ? (
              <p className="card p-4 text-sm text-ink-muted">No upcoming exam dates published yet.</p>
            ) : (
              <ul className="card divide-y divide-line overflow-hidden">
                {upcoming.map((c) => (
                  <li key={c.id}>
                    <Link href={c.examSlug ? `/exams/${c.examSlug}` : "/exam-calendar"} className="block p-3 hover:bg-brand-50">
                      <p className="truncate text-sm font-semibold text-ink">{c.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{dateLabel("Exam date", c.examDate)}: <DateValue d={c.examDate} short /></p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <AdSlot placement="home-between" />

        <section aria-labelledby="states-h">
          <SectionHeader id="states-h" title="Browse Government Jobs by State" href="/state" hrefLabel="All states" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{homeStates.map((s) => <StateCard key={s.slug} state={s} count={stateCounts[s.slug]} />)}</div>
        </section>

        <section aria-labelledby="dept-h">
          <SectionHeader id="dept-h" title="Browse by Department" href="/department" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{departments.slice(0, 12).map((d) => <DepartmentCard key={d.slug} dept={d} count={deptCounts[d.slug] ?? 0} />)}</div>
        </section>

        <section aria-labelledby="disc-h">
          <SectionHeader id="disc-h" title="Admit Cards, Results & Exam Dates" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <TileLink href="/admit-card" icon="key" title="Admit Card" desc="Hall tickets & download links" />
            <TileLink href="/results" icon="trophy" title="Results" desc="Results & cut-offs" tone="accent" />
            <TileLink href="/answer-key" icon="pen" title="Answer Key" desc="Provisional & final keys" />
            <TileLink href="/exam-calendar" icon="calendar" title="Exam Calendar" desc="Upcoming exam dates" tone="accent" />
          </div>
        </section>

        <section aria-labelledby="qual-h">
          <SectionHeader id="qual-h" title="Find Jobs by Qualification" href="/qualification" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{qualifications.map((q) => <QualificationCard key={q.slug} q={q} count={qualCounts[q.slug] ?? 0} />)}</div>
        </section>

        <section aria-labelledby="prep-h">
          <SectionHeader id="prep-h" title="Exam Preparation" href="/preparation" hrefLabel="Preparation hub" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <TileLink href="/exams" icon="book" title="Syllabus & Pattern" desc="Per-exam hubs" />
            <TileLink href="/preparation" icon="file" title="Previous Papers" desc="Being added" />
            <TileLink href="/preparation" icon="list" title="Mock Tests" desc="Planned" tone="accent" />
            <TileLink href="/preparation" icon="book" title="Current Affairs" desc="Planned" tone="accent" />
          </div>
        </section>

        <AlertCard />

        <p className="text-center text-sm text-ink-muted">Looking for something specific? <Link href="/jobs" className="font-semibold text-brand-700 underline">Search all jobs</Link>.</p>
      </div>
    </>
  );
}
