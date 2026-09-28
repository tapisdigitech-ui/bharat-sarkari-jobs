/** Shared, data-source-independent definitions used by every repository implementation. */
import type { ContentStatus, JobLevel } from "@/lib/types";
import type { ExamType } from "@/lib/gov-types";

/** Statuses the public site lists (live) and may open by URL (live + expired). Drafts/review/archived never. */
export const LIVE_STATUSES = ["published", "updated"] as const;
export const VISIBLE_STATUSES = ["published", "updated", "expired"] as const;

export interface Recruitment {
  id: string; slug: string; title: string; shortTitle?: string;
  organizationId: string; organization: string; organizationSlug?: string;
  departmentName?: string; examId?: string; examSlug?: string; examName?: string;
  level: JobLevel; stateSlug: string; stateName?: string; isAllIndia: boolean;
  cycleYear?: number; notificationNumber?: string; notificationDate?: string;
  summary?: string; officialNotificationUrl?: string; officialWebsiteUrl?: string;
  sourceName?: string; sourceCheckedAt?: string;
  status: ContentStatus; publishedAt?: string; updatedAt: string; verificationStatus?: string;
}

export interface ExamFilters { q?: string; organization?: string; type?: ExamType }
