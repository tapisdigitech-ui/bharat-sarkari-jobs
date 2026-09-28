/**
 * SYNTHETIC, clearly-labelled test notices. None of this describes a real recruitment, board or government body.
 * Dates are relative to "today" so the tests keep working over time.
 */
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
export const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const daysFromNow = (n: number) => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };

export interface ClerkVariant { lastDays: number; posts: number; corrigendum?: boolean }
export const CLERK_V1: ClerkVariant = { lastDays: 30, posts: 245 };
export const CLERK_V2: ClerkVariant = { lastDays: 45, posts: 260, corrigendum: true };

export function clerkNoticeLines(v: ClerkVariant, base: string): string[] {
  return [
    "SYNTHETIC TEST NOTICE - NOT A REAL GOVERNMENT RECRUITMENT",
    "E2E Synthetic Selection Board",
    "Advt. No. E2E/SSB/2026/07",
    "Recruitment of Junior Clerk and Data Entry Operator 2026",
    ...(v.corrigendum ? ["Corrigendum: the last date has been extended and vacancies revised."] : []),
    `Date of Notification: ${dmy(daysFromNow(-2))}`,
    `Online application from ${dmy(daysFromNow(1))} to ${dmy(daysFromNow(v.lastDays))}`,
    `Last date for receipt of online application: ${dmy(daysFromNow(v.lastDays))}`,
    `Tentative date of Computer Based Examination: ${dmy(daysFromNow(90))}`,
    `Total No. of Posts: ${v.posts}`,
    "Age Limit: 18 to 27 years as on the closing date",
    "Pay Level 2 (Rs. 19,900 - 63,200) in the pay matrix",
    "Educational Qualification: 12th pass (Intermediate) from a recognised board",
    "Application Fee: Rs. 100 for General/OBC/EWS candidates",
    "Fee for SC/ST/PwD/Women candidates: Nil (exempted)",
    "Selection process: Computer Based Test followed by Skill Test and Document Verification",
    `Apply online at ${base}/apply/clerk-2026`,
  ];
}

export function aeNoticeHtml(base: string): string {
  return `<!doctype html><html><head><title>Assistant Engineer Recruitment 2026 - E2E Synthetic Selection Board</title></head><body>
<p><strong>SYNTHETIC TEST NOTICE - NOT A REAL GOVERNMENT RECRUITMENT</strong></p>
<h1>Recruitment of Assistant Engineer (Civil) 2026</h1>
<table>
<tr><td>Advertisement No.</td><td>E2E/SSB/2026/09</td></tr>
<tr><td>Number of Posts</td><td>32</td></tr>
<tr><td>Last date of online application</td><td>${dmy(daysFromNow(25))}</td></tr>
<tr><td>Educational Qualification</td><td>B.E. / B.Tech in Civil Engineering</td></tr>
<tr><td>Age limit</td><td>21 to 30 years</td></tr>
</table>
<p><a href="${base}/apply/ae-2026">Apply Online</a> · <a href="${base}/notices/ae-2026-detailed-notification.pdf">Detailed Notification (PDF)</a></p>
</body></html>`;
}

export function admitCardHtml(base: string): string {
  return `<!doctype html><html><head><title>Admit Card - Junior Clerk CBT 2026</title></head><body>
<p>SYNTHETIC TEST NOTICE - NOT A REAL GOVERNMENT RECRUITMENT</p>
<h1>Admit Card for Junior Clerk Computer Based Examination 2026</h1>
<p>Admit cards will be available for download from ${dmy(daysFromNow(80))}.</p>
<p>Date of Computer Based Examination: ${dmy(daysFromNow(90))}</p>
<p><a href="${base}/admit/clerk-2026">Download admit card</a></p>
</body></html>`;
}

export function listingHtml(base: string, corrigendum = false): string {
  return `<!doctype html><html><head><title>Recruitment Notices - E2E Synthetic Selection Board</title></head><body>
<p>SYNTHETIC TEST SOURCE - NOT A REAL GOVERNMENT WEBSITE</p>
<nav><a href="${base}/">Home</a> <a href="${base}/rti.html">RTI</a> <a href="${base}/contact.html">Contact Us</a></nav>
<table>
<tr><td>1</td><td>Recruitment of Junior Clerk and Data Entry Operator 2026 (Advt. No. E2E/SSB/2026/07)${corrigendum ? " - Corrigendum issued" : ""}</td><td>${dmy(daysFromNow(-2))}</td><td><a href="${base}/notices/clerk-2026.pdf">Download</a></td></tr>
<tr><td>2</td><td><a href="${base}/notices/ae-2026.html">Recruitment of Assistant Engineer (Civil) 2026</a></td><td>${dmy(daysFromNow(-1))}</td></tr>
<tr><td>3</td><td><a href="${base}/notices/tender-stationery.pdf">Tender for supply of stationery items</a></td><td>${dmy(daysFromNow(-3))}</td></tr>
<tr><td>4</td><td><a href="${base}/notices/clerk-admit-card.html">Admit Card for Junior Clerk CBT 2026</a></td><td>${dmy(daysFromNow(-1))}</td></tr>
<tr><td>5</td><td><a href="${base}/private/draft-recruitment.pdf">Recruitment notice (draft, internal)</a></td><td></td></tr>
<tr><td>6</td><td><a href="https://example.com/unrelated-recruitment">Recruitment elsewhere (external site)</a></td><td></td></tr>
<tr><td>7</td><td><a href="${base}/notices/scanned-recruitment.pdf">Recruitment of Multi Tasking Staff 2026 (scanned copy)</a></td><td></td></tr>
</table></body></html>`;
}
