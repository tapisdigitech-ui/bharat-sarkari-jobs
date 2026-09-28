export type ContentStatus = "draft" | "review" | "published" | "updated" | "expired" | "archived";
export type JobLevel = "central" | "state" | "district" | "municipal" | "panchayat" | "psu";
export type JobType = "permanent" | "contract" | "apprenticeship" | "deputation";

export interface State {
  slug: string;
  name: string;
  kind: "state" | "ut";
  /** ISO 3166-2:IN code, e.g. "UP" */
  code: string;
  /** Database id (absent for the demo/seed source). */
  id?: number;
  /** false = archived: hidden from pickers/nav but still resolves for historical records. */
  isActive?: boolean;
}

export interface District {
  slug: string;
  name: string;
  stateSlug: string;
  /** Local Government Directory code (official identifier), when imported from an official list. */
  lgdCode?: string;
  id?: number;
  isActive?: boolean;
}

export interface Department {
  slug: string;
  name: string;
  short: string;
  description: string;
  id?: number;
  isActive?: boolean;
}

export interface Qualification {
  slug: string;
  name: string; // "10th Pass"
  pageTitle: string; // "10th Pass Government Jobs"
  description: string;
  rank: number; // ordering by education level
  id?: number;
  isActive?: boolean;
}

export interface Organization {
  id?: string;
  slug: string;
  name: string;
  shortName?: string;
  level: JobLevel;
  departmentSlug?: string;
  stateSlug?: string;
  officialWebsite?: string;
  description?: string;
  isActive?: boolean;
}

export interface ImportantDate {
  label: string;
  /** ISO date (YYYY-MM-DD) or null when officially "to be announced" */
  date: string | null;
  note?: string;
  /** Official = confirmed by the official source; Expected = our estimate. Undefined for plain recorded dates. */
  status?: "official" | "expected";
  /** Wording for expected dates, e.g. “October 2026”. */
  expectedText?: string;
}

export interface VacancyRow {
  post: string;
  category?: string;
  count: number | null;
}

export interface OfficialLink {
  label: string;
  url: string;
}

export interface Job {
  id: string;
  slug: string;
  title: string;
  organization: string;
  advertisementNo?: string;
  departmentSlug: string;
  stateSlug: string | "all-india";
  districtName?: string;
  districtSlug?: string;
  /** Display labels resolved from the reference tables by the data layer (so UI code needs no lookups). */
  stateName?: string;
  departmentName?: string;
  qualificationNames?: string[];
  organizationSlug?: string;
  recruitmentSlug?: string;
  recruitmentId?: string;
  recruitmentTitle?: string;
  level: JobLevel;
  jobType: JobType;
  qualificationSlugs: string[];
  categorySlugs?: string[];
  examSlug?: string;
  examId?: string;
  vacancies: number | null;
  postedAt: string; // ISO date
  updatedAt: string;
  /** SOURCE_CHECKED | NEEDS_REVIEW | SOURCE_UNAVAILABLE | EXPIRED | ARCHIVED (Phase 3 monitoring). */
  verificationStatus?: string;
  publishedAt: string;
  lastDate: string | null; // ISO date; null = not officially announced
  status: ContentStatus;
  isDemo: boolean;
  womenOnly?: boolean;
  fresherFriendly?: boolean;
  salary?: string;
  payLevel?: string;
  ageMin?: number;
  ageMax?: number;
  ageRelaxation?: string;
  fee?: { general?: string; reserved?: string; note?: string };
  selectionProcess: string[];
  examPattern?: string[];
  syllabusSummary?: string;
  documentsRequired: string[];
  howToApply: string[];
  importantDates: ImportantDate[];
  vacancyBreakdown: VacancyRow[];
  summary: string; // OUR explanatory content (clearly separated from official facts in the UI)
  // Phase 2A additions (all optional so the demo dataset keeps working)
  shortTitle?: string;
  employmentType?: string;
  experience?: string;
  qualificationDetails?: string;
  eligibilityExplanation?: string;
  importantInstructions?: string;
  interviewDetails?: string;
  physicalTestDetails?: string;
  skillTestDetails?: string;
  documentVerificationDetails?: string;
  otherStagesDetails?: string;
  source: {
    organization: string;
    name?: string;
    type?: string;
    url?: string | null;
    notificationUrl: string | null;
    websiteUrl: string | null;
    applyUrl: string | null;
    checkedAt: string; // ISO date (IST)
    checkedAtISO?: string | null; // full timestamp for "checked at" display
    lastVerifiedAt?: string | null;
  };
}

export type UpdateKind = "job" | "admit-card" | "result" | "answer-key" | "exam-date" | "application" | "notice";

export interface SiteUpdate {
  id: string;
  kind: UpdateKind;
  title: string;
  href: string;
  date: string;
  isDemo: boolean;
}

export interface Exam {
  slug: string;
  name: string;
  conductedBy: string;
  level: JobLevel;
  overview: string;
  isDemo: boolean;
}

export interface DiscoveryItem {
  id: string;
  slug: string;
  title: string;
  organization: string;
  examSlug?: string;
  date: string; // release date
  officialUrl: string | null;
  note?: string;
  isDemo: boolean;
}

export interface CalendarEntry {
  id: string;
  title: string;
  organization: string;
  date: string | null; // null => "to be announced"
  kind: "exam" | "application-start" | "application-end" | "admit-card" | "result";
  officialUrl: string | null;
  isDemo: boolean;
}

export interface JobFilters {
  q?: string;
  state?: string;
  qualification?: string;
  department?: string;
  organization?: string;
  /** Job category slug (Police, Teaching, …); a job can be in several. */
  category?: string;
  /** District slug (only meaningful together with `state`). */
  district?: string;
  level?: JobLevel;
  jobType?: JobType;
  exam?: string;
  postedWithin?: 1 | 7 | 30;
  closingWithin?: 3 | 7 | 30;
  fresher?: boolean;
  women?: boolean;
}

export type JobSort = "latest" | "closing" | "vacancies";
