/** Recruitments facade (public reads). Implementations: ./supabase/recruitments.ts, ./demo/port.ts. */
import "server-only";
import { port } from "./port";
import type { ContentPort } from "./ports";

export { LIVE_STATUSES, VISIBLE_STATUSES, type Recruitment } from "./statuses";

export const getRecruitment: ContentPort["getRecruitment"] = (slug) => port().getRecruitment(slug);
export const jobsOfRecruitment: ContentPort["jobsOfRecruitment"] = (id) => port().jobsOfRecruitment(id);
export const listRecruitments: ContentPort["listRecruitments"] = (o) => port().listRecruitments(o);
export const sitemapRecruitments: ContentPort["sitemapRecruitments"] = () => port().sitemapRecruitments();
