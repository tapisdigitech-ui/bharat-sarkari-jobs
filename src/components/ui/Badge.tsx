import type { ReactNode } from "react";

type Tone = "new" | "updated" | "urgent" | "neutral" | "demo";
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export const DemoBadge = () => <Badge tone="demo">Demo data</Badge>;
