import type { Metadata } from "next";
import { absoluteUrl, site } from "@/config/site";

interface Opts {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  type?: "website" | "article";
}

/** Consistent metadata: canonical, Open Graph, Twitter. `title` gets the site suffix via the root template. */
export function buildMetadata({ title, description, path, noindex, type = "website" }: Opts): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    // Phase 3.7 finding: a page's `robots: undefined` REPLACED the root layout's staging noindex, so on a non-indexable
    // deployment (staging, preview, demo) every page built here was indexable apart from robots.txt. Decide it here.
    ...(!site.indexable ? { robots: { index: false, follow: false } } : noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: { title, description, url, siteName: site.name, locale: site.locale, type },
    twitter: { card: "summary", title, description },
  };
}
