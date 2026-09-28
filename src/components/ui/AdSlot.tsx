import { site } from "@/config/site";

/**
 * Reserved ad position. Reserves fixed space (prevents CLS) but renders NOTHING visible unless ads are enabled.
 * When NEXT_PUBLIC_ADS_ENABLED=false the slot collapses to zero height so v1 stays clean.
 * Wire the ad network's script inside the enabled branch later.
 */
export type AdPlacement = "home-between" | "sidebar" | "list-inline" | "content-between" | "mobile-bottom";
const sizes: Record<AdPlacement, string> = {
  "home-between": "min-h-[100px] md:min-h-[90px]",
  sidebar: "min-h-[250px]",
  "list-inline": "min-h-[100px]",
  "content-between": "min-h-[250px]",
  "mobile-bottom": "min-h-[50px]",
};

export function AdSlot({ placement, className = "" }: { placement: AdPlacement; className?: string }) {
  if (!site.adsEnabled) return null;
  return (
    <aside aria-label="Advertisement" data-ad-slot={placement} className={`${sizes[placement]} ${className} flex items-center justify-center rounded-md border border-dashed border-line bg-white/60 text-xs text-ink-muted`}>
      Advertisement
    </aside>
  );
}
