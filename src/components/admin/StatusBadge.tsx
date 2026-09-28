import type { ContentStatus } from "@/lib/types";

const styles: Record<ContentStatus, string> = {
  draft: "bg-[#eef2f7] text-ink-soft",
  review: "bg-warning-50 text-warning-700",
  published: "bg-success-50 text-success-700",
  updated: "bg-brand-50 text-brand-700",
  expired: "bg-danger-50 text-danger-700",
  archived: "bg-[#eef2f7] text-ink-muted",
};
const labels: Record<ContentStatus, string> = { draft: "Draft", review: "In review", published: "Published", updated: "Published (updated)", expired: "Expired", archived: "Archived" };

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <span className={`badge ${styles[status]}`}>{labels[status]}</span>;
}
export const statusLabel = (s: ContentStatus) => labels[s];
