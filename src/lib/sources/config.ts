/** Source-registry vocabularies (client-safe; mirrors the CHECK constraints in 0010_source_registry.sql). */
export const SOURCE_TYPES = [
  ["CENTRAL_GOVERNMENT", "Central Government"], ["STATE_GOVERNMENT", "State Government"], ["DISTRICT_GOVERNMENT", "District Government"],
  ["PSU", "PSU"], ["UNIVERSITY", "University"], ["COURT", "Court"], ["MUNICIPAL", "Municipal"], ["PANCHAYAT", "Panchayat"],
  ["HEALTH", "Health"], ["EDUCATION", "Education"], ["RECRUITMENT_BOARD", "Recruitment Board / Commission"], ["OTHER_OFFICIAL", "Other official"],
] as const;
export const SOURCE_STATUSES = [
  ["ACTIVE", "Active"], ["PAUSED", "Paused"], ["ERROR", "Error"], ["BLOCKED", "Blocked"], ["REVIEW_REQUIRED", "Review required"], ["ARCHIVED", "Archived"],
] as const;
export const AUTHORITY_RANKS = [
  [1, "1 · Official government department"], [2, "2 · Official recruitment board"], [3, "3 · Official commission"], [4, "4 · Official PSU"],
  [5, "5 · Official university / institution"], [6, "6 · Official district administration"], [7, "7 · Other authoritative government source"],
] as const;
export const PRIORITIES = [["high", "High (every few hours)"], ["normal", "Normal (daily)"], ["low", "Low activity (every few days)"]] as const;
export const DEFAULT_INTERVAL: Record<string, number> = { high: 6, normal: 24, low: 72 };

export const sourceTypeLabel = (t: string) => SOURCE_TYPES.find(([v]) => v === t)?.[1] ?? t;
export const sourceStatusLabel = (t: string) => SOURCE_STATUSES.find(([v]) => v === t)?.[1] ?? t;
export const sourceStatusClass = (s: string) =>
  s === "ACTIVE" ? "bg-success-50 text-success-700" : s === "ERROR" || s === "BLOCKED" ? "bg-danger-50 text-danger-700"
  : s === "REVIEW_REQUIRED" ? "bg-warning-50 text-warning-700" : "bg-[#eef2f7] text-ink-soft";

export const RUN_STATUS_CLASS: Record<string, string> = {
  running: "bg-brand-50 text-brand-700", succeeded: "bg-success-50 text-success-700", partial: "bg-warning-50 text-warning-700",
  failed: "bg-danger-50 text-danger-700", blocked: "bg-danger-50 text-danger-700", skipped: "bg-[#eef2f7] text-ink-soft",
};
export const CONFIDENCE_CLASS: Record<string, string> = { HIGH: "bg-success-50 text-success-700", MEDIUM: "bg-warning-50 text-warning-700", LOW: "bg-danger-50 text-danger-700" };
export const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for review", needs_review: "Needs senior review", approved: "Approved", rejected: "Rejected", merged: "Merged", ignored: "Ignored", superseded: "Superseded by a newer version",
};
export const VERIFICATION_LABEL: Record<string, string> = {
  SOURCE_CHECKED: "Source checked", NEEDS_REVIEW: "Needs source review", SOURCE_UNAVAILABLE: "Official source unavailable", EXPIRED: "Expired", ARCHIVED: "Archived",
};
export const VERIFICATION_CLASS: Record<string, string> = {
  SOURCE_CHECKED: "bg-success-50 text-success-700", NEEDS_REVIEW: "bg-warning-50 text-warning-700", SOURCE_UNAVAILABLE: "bg-danger-50 text-danger-700",
  EXPIRED: "bg-[#eef2f7] text-ink-soft", ARCHIVED: "bg-[#eef2f7] text-ink-muted",
};
