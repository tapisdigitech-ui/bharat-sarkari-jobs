import type { ReactNode } from "react";
import Link from "next/link";
import { site } from "@/config/site";

export interface InfoPage { slug: string; title: string; description: string; legal?: boolean; body: () => ReactNode }

const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;

export const infoPages: InfoPage[] = [
  {
    slug: "about", title: "About Us", description: `About ${site.name}: an independent government jobs and exam information platform.`,
    body: () => (<>
      <P>{site.name} {site.independenceStatement}</P>
      <h2>What we do</h2>
      <P>We organise government recruitment information — jobs, admit cards, results, answer keys and exam dates — into a consistent format, explain it in plain language, and link to the official source for every item.</P>
      <h2>What we do not do</h2>
      <ul><li>We are not a government body and do not accept applications or fees.</li><li>We do not claim that a listing is verified beyond what the source page shows and the &ldquo;date source last checked&rdquo; we display.</li><li>We do not use government emblems or imply endorsement.</li></ul>
    </>),
  },
  {
    slug: "contact", title: "Contact", description: `Contact ${site.name}.`,
    body: () => (<>
      <P>Found an error or an outdated date? Please tell us and include the page link and the official source that shows the correct information. See our <Link href="/correction-policy">Correction Policy</Link>.</P>
      <P>Email: <strong>{site.contactEmail}</strong> <em>(placeholder — set a real address before launch)</em></P>
    </>),
  },
  {
    slug: "advertise", title: "Advertise", description: `Advertising and partnership information for ${site.name}.`,
    body: () => (<>
      <P>Advertising is not live yet. When it launches, ad placements will be clearly labelled and kept separate from job information, and sponsored content will never be presented as official recruitment information.</P>
      <P>For partnership enquiries (education, exam preparation), write to <strong>{site.contactEmail}</strong> <em>(placeholder)</em>.</P>
    </>),
  },
  {
    slug: "disclaimer", title: "Disclaimer", description: "Disclaimer for information published on this website.", legal: true,
    body: () => (<>
      <P>{site.name} {site.independenceStatement}</P>
      <P>Information is summarised from official sources for convenience and may contain errors or become outdated. Dates, vacancies, eligibility and fees can change or be corrected by the recruiting body. Always verify on the official notification and website before applying or paying any fee.</P>
      <P>We are not responsible for decisions made on the basis of this website. External links lead to third-party websites we do not control.</P>
    </>),
  },
  {
    slug: "privacy-policy", title: "Privacy Policy", description: "How this website handles personal data.", legal: true,
    body: () => (<>
      <P>This is a draft outline. It must be replaced with a policy reviewed against India&rsquo;s Digital Personal Data Protection Act, 2023 and the practices actually used (analytics, advertising cookies, email alerts) before launch.</P>
      <h2>Data we expect to handle</h2>
      <ul><li>Account details (email, name) if you register.</li><li>Alert preferences (states, qualifications, departments).</li><li>Standard technical data (IP address, device, pages visited) through analytics/advertising partners once enabled.</li></ul>
      <P>We will not sell your personal information. Consent and unsubscribe options will be provided for every alert.</P>
    </>),
  },
  {
    slug: "terms", title: "Terms & Conditions", description: "Terms of use.", legal: true,
    body: () => (<>
      <P>This is a draft outline to be finalised with legal review. By using the site you agree to use it lawfully, not to scrape it at a rate that harms availability, and to verify all recruitment details on the official source.</P>
      <P>Content that is our own explanation is provided &ldquo;as is&rdquo; without warranty.</P>
    </>),
  },
  {
    slug: "editorial-policy", title: "Editorial Policy", description: "How we source, write and update recruitment information.",
    body: () => (<>
      <h2>Sourcing</h2>
      <P>Recruitment facts come from the recruiting organisation&rsquo;s official notification or website. We link to that source on every page and show when we last checked it.</P>
      <h2>Separation of fact and explanation</h2>
      <P>Official facts (dates, vacancies, eligibility) are presented separately from our explanatory writing, which is labelled as ours.</P>
      <h2>Review and publishing</h2>
      <P>Content moves through draft, review, published, updated and expired/archived states. Nothing is published automatically from a scraper without human review.</P>
      <h2>Missing information</h2>
      <P>If the official source does not state something, we say so instead of guessing.</P>
    </>),
  },
  {
    slug: "correction-policy", title: "Correction Policy", description: "How to report an error and how we fix it.",
    body: () => (<>
      <P>If you find a mistake, contact us with the page link and the official source showing the correct information. We compare against the official source, correct the page, and update the &ldquo;updated&rdquo; date. Significant corrections are noted on the page.</P>
    </>),
  },
];

export const infoBySlug = (slug: string) => infoPages.find((p) => p.slug === slug);
