/**
 * Public trust display rules (Phase 3.6 item 8). Pure functions shared by every detail page.
 * The database decides what may be published (0022_source_trust.sql); these helpers decide how honestly it is described.
 */

/** Host of a link, without "www." — shown next to every external link so readers can see where it goes. */
export function linkHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

/** .gov.in / .nic.in hosts. (Registered official domains outside these are checked by the database, not here.) */
export const isGovernmentHost = (host: string | null) => !!host && /(^|\.)(gov\.in|nic\.in)$/.test(host);

export type VerificationStatus = "SOURCE_CHECKED" | "NEEDS_REVIEW" | "SOURCE_UNAVAILABLE" | "EXPIRED" | "ARCHIVED";

/** Plain-language verification line. Never claims more than was recorded. */
export function verificationText(status: string | null | undefined): { text: string; tone: "ok" | "warn" | "muted" } {
  switch (status) {
    case "SOURCE_CHECKED": return { text: "Checked against the official source", tone: "ok" };
    case "SOURCE_UNAVAILABLE": return { text: "Official website did not respond at our last check", tone: "warn" };
    case "EXPIRED": return { text: "Closed — kept for reference", tone: "muted" };
    case "ARCHIVED": return { text: "Archived", tone: "muted" };
    default: return { text: "Awaiting a fresh check against the official source", tone: "warn" };
  }
}

/**
 * Where the facts on the page come from. An editor-created record without an official notification document must not read
 * as if it were summarised from one.
 */
export function provenanceSentence(o: { isDemo?: boolean; organization: string; notificationUrl?: string | null; document?: string }): string {
  if (o.isDemo) return "This is a demo record used for development. It does not describe a real recruitment and has no official source.";
  if (o.notificationUrl) return `Facts on this page are summarised by our editors from the official ${o.document ?? "notification"} published by ${o.organization}. Our explanations are our own writing and are marked as such.`;
  return `Facts on this page were compiled by our editors from the official website of ${o.organization}. No official ${o.document ?? "notification"} document is linked yet, so treat every detail as provisional until you have confirmed it there.`;
}
