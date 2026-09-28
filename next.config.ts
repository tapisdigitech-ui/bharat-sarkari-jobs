import type { NextConfig } from "next";
import { indexingAllowed } from "./src/lib/env-rules";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      // Staff pages are private: never cached by the browser, a CDN or a proxy.
      // Staging / preview / demo: a noindex header on every response as well as the meta tag and robots.txt (Phase 3.7).
      ...(indexingAllowed(process.env) ? [] : [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }]),
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }, { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Phase 3.5 production review: HTTPS-only for two years (Vercel serves HTTPS; this pins browsers to it) and no
          // powerful browser features for this content site.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
