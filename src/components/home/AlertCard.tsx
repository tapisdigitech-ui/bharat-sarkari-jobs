import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { getRefSafe } from "@/lib/data/ref";

/**
 * Alert preferences preview. Submission is intentionally DISABLED: the alert backend
 * (subscriptions table, double opt-in email, sender) is not built yet, and a form that
 * silently discards input would be dishonest. Schema: job_alerts / notifications.
 */
export async function AlertCard() {
  const { states, qualifications } = await getRefSafe();
  return (
    <section id="alerts" aria-labelledby="alerts-h" className="scroll-mt-32 rounded-2xl bg-brand-800 p-5 text-white md:p-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
        <div>
          <p className="flex items-center gap-2"><Icon name="bell" /> <Badge tone="neutral">Coming soon</Badge></p>
          <h2 id="alerts-h" className="mt-2 text-2xl font-extrabold">Get alerts for the jobs that match you</h2>
          <p className="mt-2 text-brand-100">Pick your state, qualification and department, and we&rsquo;ll email new jobs, last-date reminders, admit cards and results. Alerts are being built — this form is a preview and does not collect your details yet.</p>
        </div>
        <form aria-label="Job alert preferences (preview)" className="grid gap-3 sm:grid-cols-2" action="#">
          <fieldset disabled className="contents">
            <div><label htmlFor="al-state" className="mb-1 block text-sm font-semibold">State</label>
              <select id="al-state" className="input text-ink"><option>Any state</option>{states.map((s) => <option key={s.slug}>{s.name}</option>)}</select></div>
            <div><label htmlFor="al-qual" className="mb-1 block text-sm font-semibold">Qualification</label>
              <select id="al-qual" className="input text-ink"><option>Any</option>{qualifications.map((q) => <option key={q.slug}>{q.name}</option>)}</select></div>
            <div className="sm:col-span-2"><label htmlFor="al-email" className="mb-1 block text-sm font-semibold">Email</label>
              <input id="al-email" type="email" placeholder="you@example.com" className="input text-ink" /></div>
            <button type="button" className="btn btn-accent cursor-not-allowed opacity-70 sm:col-span-2">Alerts launching soon</button>
          </fieldset>
        </form>
      </div>
    </section>
  );
}
