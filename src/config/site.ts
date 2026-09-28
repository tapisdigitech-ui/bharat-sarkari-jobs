/**
 * Single source of truth for branding. The name is a WORKING NAME —
 * change it here (or via env) and every page, metadata, schema and footer follows.
 */
import { indexingAllowed } from "@/lib/env-rules";

export const site = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "BharatSarkariJobs",
  tagline: "All Government Jobs. One Destination.",
  positioning: "All Government Jobs in One Place — Central, State, District & Local",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  locale: "en_IN",
  contactEmail: "contact@example.com", // placeholder — replace before launch
  social: {
    // Empty until real accounts exist; footer only renders non-empty entries.
    x: "",
    facebook: "",
    youtube: "",
    telegram: "",
    whatsapp: "",
  },
  independenceStatement:
    "is an independent information platform. It is not affiliated with, owned by, or endorsed by any government body. Always confirm details on the official notification before applying.",
  /** Search engines are blocked unless ALLOW_INDEXING=true — and always for demo data and preview deployments (env-rules.ts). */
  indexable: indexingAllowed(process.env),
  adsEnabled: process.env.NEXT_PUBLIC_ADS_ENABLED === "true",
} as const;

export const absoluteUrl = (path = "/") => `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
