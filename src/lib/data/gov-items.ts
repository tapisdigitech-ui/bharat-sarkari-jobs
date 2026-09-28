/** Admit cards, results and answer keys facade (public reads). Implementations: ./supabase/gov-items.ts, ./demo/port.ts. */
import "server-only";
import { port } from "./port";
import type { ContentPort } from "./ports";

export const listGov: ContentPort["listGov"] = (kind, f, o) => port().listGov(kind, f, o);
export const getGovBySlug: ContentPort["getGovBySlug"] = (kind, slug) => port().getGovBySlug(kind, slug);
export const sitemapGov: ContentPort["sitemapGov"] = (kind) => port().sitemapGov(kind);
export const relatedGov: ContentPort["relatedGov"] = (kind, link, o) => port().relatedGov(kind, link, o);
export const govTypes: ContentPort["govTypes"] = (kind) => port().govTypes(kind);
export const govFacets: ContentPort["govFacets"] = (kind) => port().govFacets(kind);
