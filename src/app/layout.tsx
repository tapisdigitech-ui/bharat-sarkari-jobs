import type { Metadata, Viewport } from "next";
import "./globals.css";
import { site } from "@/config/site";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SiteChrome } from "@/components/layout/SiteChrome";
import { JsonLd } from "@/components/seo/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo/schema";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name} — ${site.positioning}`, template: `%s | ${site.name}` },
  description: "Search central, state and district government jobs across India with clear eligibility, dates and links to the official notification.",
  applicationName: site.name,
  openGraph: { siteName: site.name, locale: site.locale, type: "website" },
  robots: site.indexable ? undefined : { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f3a78" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="flex min-h-screen flex-col">
        <SiteChrome top={<><JsonLd data={[organizationSchema(), websiteSchema()]} /><Header /></>} bottom={<Footer />}>{children}</SiteChrome>
      </body>
    </html>
  );
}
