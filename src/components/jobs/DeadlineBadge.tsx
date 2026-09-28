import { Badge } from "@/components/ui/Badge";
import { deadlineStatus } from "@/lib/dates";

/** Urgency is derived strictly from an official last date. No date => no countdown. */
export function DeadlineBadge({ lastDate }: { lastDate: string | null }) {
  const d = deadlineStatus(lastDate);
  if (d.state === "unknown" || d.state === "open") return null;
  if (d.state === "closed") return <Badge tone="neutral">Closed</Badge>;
  return <Badge tone="urgent">{d.label}</Badge>;
}
