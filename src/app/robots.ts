import type { MetadataRoute } from "next";
import { absoluteUrl, site } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  if (!site.indexable) return { rules: { userAgent: "*", disallow: "/" } }; // demo/staging: keep out of search engines
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/login", "/register", "/alerts"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
