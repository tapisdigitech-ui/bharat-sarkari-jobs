/** What must be present before a job can be published (mirrors assert_job_publishable in the database). */
export function publishReadiness(j: Partial<{ title: string; organization: string; state_slug: string | null; source_name: string | null; source_checked_at: string | null; notification_url: string | null; official_website_url: string | null; qualification_slugs: string[]; last_date: string | null }>, today: string): { label: string; ok: boolean }[] {
  return [
    { label: "Title", ok: !!j.title?.trim() },
    { label: "Organization", ok: !!j.organization?.trim() },
    { label: "State (or All India)", ok: !!j.state_slug },
    { label: "At least one qualification", ok: !!j.qualification_slugs?.length },
    { label: "Source name", ok: !!j.source_name?.trim() },
    { label: "Source last-checked date recorded", ok: !!j.source_checked_at },
    { label: "Official notification URL or official website URL", ok: !!(j.notification_url || j.official_website_url) },
    { label: "Last date not in the past", ok: !j.last_date || j.last_date >= today },
  ];
}
