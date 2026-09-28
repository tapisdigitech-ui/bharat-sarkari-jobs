"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** The public header/footer/JSON-LD are not shown inside the admin console, which has its own shell. */
export function SiteChrome({ top, bottom, children }: { top: ReactNode; bottom: ReactNode; children: ReactNode }) {
  const admin = usePathname().startsWith("/admin");
  return (
    <>
      {!admin && top}
      <main id="main" className="flex-1">{children}</main>
      {!admin && bottom}
    </>
  );
}
