/**
 * DEMO DATA — development only.
 * Everything here is fictional and flagged `isDemo: true`. Organisation names, vacancy counts,
 * dates and notification numbers are placeholders and do NOT correspond to any real recruitment.
 * Dates are generated relative to "today" so that deadline states can be exercised.
 * Delete this file (and set DATA_SOURCE=supabase) once real content is entered via the admin panel.
 */
import type { CalendarEntry, DiscoveryItem, Exam, Job, JobLevel, JobType, SiteUpdate } from "@/lib/types";
import { addDays, todayIST } from "@/lib/dates";

const today = todayIST();

interface Seed {
  slug: string;
  title: string;
  org: string;
  dept: string;
  state: string;
  level: JobLevel;
  quals: string[];
  vacancies: number | null;
  postedAgo: number;
  lastIn: number | null;
  type?: JobType;
  exam?: string;
  fresher?: boolean;
  women?: boolean;
  district?: string;
  updated?: boolean;
}

const seeds: Seed[] = [
  { slug: "demo-graduate-level-combined-recruitment", title: "Combined Graduate Level Recruitment", org: "Demo Staff Selection Board", dept: "ssc", state: "all-india", level: "central", quals: ["graduate"], vacancies: 1200, postedAgo: 1, lastIn: 21, exam: "demo-combined-graduate-exam", fresher: true },
  { slug: "demo-constable-recruitment-up", title: "Police Constable Recruitment", org: "Demo State Police Recruitment Board", dept: "police", state: "uttar-pradesh", level: "state", quals: ["12th-pass"], vacancies: 3000, postedAgo: 2, lastIn: 2, fresher: true, exam: "demo-police-constable-exam" },
  { slug: "demo-multi-tasking-staff-delhi", title: "Multi Tasking Staff Recruitment", org: "Demo Delhi Services Board", dept: "other", state: "delhi", level: "state", quals: ["10th-pass"], vacancies: 450, postedAgo: 3, lastIn: 0, fresher: true },
  { slug: "demo-railway-technician-recruitment", title: "Railway Technician Recruitment", org: "Demo Railway Recruitment Board", dept: "railways", state: "all-india", level: "central", quals: ["iti", "diploma"], vacancies: 800, postedAgo: 4, lastIn: 15, fresher: true, updated: true },
  { slug: "demo-staff-nurse-recruitment-bihar", title: "Staff Nurse Recruitment", org: "Demo Health Department, Bihar", dept: "health", state: "bihar", level: "state", quals: ["medical", "12th-pass"], vacancies: 620, postedAgo: 5, lastIn: 3, women: true },
  { slug: "demo-primary-teacher-rajasthan", title: "Primary Teacher Recruitment", org: "Demo Education Department, Rajasthan", dept: "teaching", state: "rajasthan", level: "state", quals: ["graduate", "teaching"], vacancies: 2100, postedAgo: 6, lastIn: 10, exam: "demo-teacher-eligibility" },
  { slug: "demo-anganwadi-worker-madhya-pradesh", title: "Anganwadi Worker & Helper Recruitment", org: "Demo Women & Child Development, District Office", dept: "anganwadi", state: "madhya-pradesh", level: "district", quals: ["10th-pass", "12th-pass"], vacancies: 95, postedAgo: 2, lastIn: 12, women: true, district: "Bhopal", type: "contract" },
  { slug: "demo-probationary-officer-banking", title: "Probationary Officer Recruitment", org: "Demo Public Sector Bank", dept: "banking", state: "all-india", level: "psu", quals: ["graduate"], vacancies: 500, postedAgo: 8, lastIn: 5, fresher: true, exam: "demo-banking-officer-exam" },
  { slug: "demo-junior-engineer-maharashtra", title: "Junior Engineer (Civil) Recruitment", org: "Demo Public Works Department, Maharashtra", dept: "state-psc", state: "maharashtra", level: "state", quals: ["engineering", "diploma"], vacancies: 240, postedAgo: 9, lastIn: 18 },
  { slug: "demo-apprentice-psu-gujarat", title: "Trade Apprentice Recruitment", org: "Demo Power Corporation, Gujarat", dept: "psu", state: "gujarat", level: "psu", quals: ["iti"], vacancies: 180, postedAgo: 3, lastIn: 25, type: "apprenticeship", fresher: true },
  { slug: "demo-assistant-professor-karnataka", title: "Assistant Professor Recruitment", org: "Demo State University, Karnataka", dept: "universities", state: "karnataka", level: "state", quals: ["post-graduate"], vacancies: 130, postedAgo: 12, lastIn: 30 },
  { slug: "demo-district-court-clerk-tamil-nadu", title: "Court Clerk / Office Assistant Recruitment", org: "Demo District Court Establishment", dept: "courts", state: "tamil-nadu", level: "district", quals: ["12th-pass", "graduate"], vacancies: 75, postedAgo: 4, lastIn: 1, district: "Chennai" },
  { slug: "demo-legal-officer-west-bengal", title: "Legal Officer Recruitment", org: "Demo Legal Affairs Department, West Bengal", dept: "courts", state: "west-bengal", level: "state", quals: ["law"], vacancies: 40, postedAgo: 14, lastIn: 8 },
  { slug: "demo-municipal-sanitary-inspector-punjab", title: "Sanitary Inspector Recruitment", org: "Demo Municipal Corporation, Punjab", dept: "municipal", state: "punjab", level: "municipal", quals: ["12th-pass", "diploma"], vacancies: 60, postedAgo: 7, lastIn: 14, district: "Ludhiana" },
  { slug: "demo-panchayat-secretary-haryana", title: "Panchayat Secretary Recruitment", org: "Demo Rural Development Department, Haryana", dept: "panchayat", state: "haryana", level: "panchayat", quals: ["graduate"], vacancies: 310, postedAgo: 10, lastIn: 6, updated: true },
  { slug: "demo-nhm-community-health-officer-odisha", title: "Community Health Officer (NHM) Recruitment", org: "Demo National Health Mission, Odisha", dept: "nhm", state: "odisha", level: "state", quals: ["medical", "graduate"], vacancies: 210, postedAgo: 1, lastIn: 20, type: "contract" },
  { slug: "demo-soldier-technical-defence", title: "Soldier (Technical) Recruitment Rally", org: "Demo Defence Recruitment Office", dept: "defence", state: "all-india", level: "central", quals: ["12th-pass"], vacancies: null, postedAgo: 5, lastIn: null, fresher: true },
  { slug: "demo-civil-services-preliminary", title: "Civil Services Examination Notification", org: "Demo Public Service Commission", dept: "upsc", state: "all-india", level: "central", quals: ["graduate"], vacancies: 900, postedAgo: 20, lastIn: -3, fresher: true },
];

const DEMO_NOTE = "This is DEMO content for development and does not describe a real recruitment.";

function build(s: Seed, i: number): Job {
  const posted = addDays(today, -s.postedAgo);
  const last = s.lastIn === null ? null : addDays(today, s.lastIn);
  const expired = s.lastIn !== null && s.lastIn < 0;
  return {
    id: `demo-${i + 1}`,
    slug: s.slug,
    title: `${s.title} (Demo)`,
    organization: s.org,
    advertisementNo: `DEMO/${String(i + 1).padStart(3, "0")}/2026`,
    departmentSlug: s.dept,
    stateSlug: s.state,
    districtName: s.district,
    level: s.level,
    jobType: s.type ?? "permanent",
    qualificationSlugs: s.quals,
    examSlug: s.exam,
    vacancies: s.vacancies,
    postedAt: posted,
    publishedAt: posted,
    updatedAt: s.updated ? addDays(today, -1) : posted,
    lastDate: last,
    status: expired ? "expired" : s.updated ? "updated" : "published",
    isDemo: true,
    womenOnly: s.women,
    fresherFriendly: s.fresher,
    selectionProcess: ["Written examination", "Document verification", "Final merit list"],
    examPattern: ["Demo pattern: objective-type questions", "Demo pattern: negative marking as per official notice"],
    syllabusSummary: "Demo syllabus summary. Real pages will summarise the officially published syllabus and link to it.",
    documentsRequired: ["Proof of date of birth", "Educational certificates", "Category certificate (if applicable)", "Recent photograph and signature", "Valid photo ID"],
    howToApply: [
      "Read the official notification fully before applying.",
      "Open the official application link from the Important Links section.",
      "Register, fill in the form and upload the required documents.",
      "Pay the application fee (if applicable) and keep a copy of the confirmation.",
    ],
    importantDates: [
      { label: "Notification date", date: posted },
      { label: "Online application starts", date: posted },
      { label: "Last date to apply", date: last, note: last ? undefined : "Not announced in the source" },
      { label: "Exam date", date: null, note: "Refer to official notice" },
    ],
    vacancyBreakdown: s.vacancies ? [{ post: s.title, count: s.vacancies }] : [{ post: s.title, count: null }],
    summary: `${DEMO_NOTE} In a live page, this space holds a short plain-language explanation written by our editors, kept visibly separate from the official facts.`,
    source: {
      organization: s.org,
      notificationUrl: null, // demo: no real notification exists
      websiteUrl: null,
      applyUrl: null,
      checkedAt: today,
    },
  };
}

export const demoJobs: Job[] = seeds.map(build);

export const demoExams: Exam[] = [
  { slug: "demo-combined-graduate-exam", name: "Combined Graduate Level Exam (Demo)", conductedBy: "Demo Staff Selection Board", level: "central", overview: "Demo exam hub. A live exam hub carries overview, eligibility, syllabus, pattern, dates and links to official sources.", isDemo: true },
  { slug: "demo-police-constable-exam", name: "Police Constable Exam (Demo)", conductedBy: "Demo State Police Recruitment Board", level: "state", overview: "Demo exam hub for structure testing only.", isDemo: true },
  { slug: "demo-teacher-eligibility", name: "Teacher Eligibility Test (Demo)", conductedBy: "Demo Education Department, Rajasthan", level: "state", overview: "Demo exam hub for structure testing only.", isDemo: true },
  { slug: "demo-banking-officer-exam", name: "Banking Officer Exam (Demo)", conductedBy: "Demo Public Sector Bank", level: "psu", overview: "Demo exam hub for structure testing only.", isDemo: true },
];

export const demoAdmitCards: DiscoveryItem[] = [
  { id: "ac1", slug: "demo-police-constable-admit-card", title: "Police Constable Exam Admit Card (Demo)", organization: "Demo State Police Recruitment Board", examSlug: "demo-police-constable-exam", date: addDays(today, -1), officialUrl: null, isDemo: true },
  { id: "ac2", slug: "demo-banking-officer-admit-card", title: "Banking Officer Prelims Admit Card (Demo)", organization: "Demo Public Sector Bank", examSlug: "demo-banking-officer-exam", date: addDays(today, -3), officialUrl: null, isDemo: true },
];
export const demoResults: DiscoveryItem[] = [
  { id: "r1", slug: "demo-teacher-eligibility-result", title: "Teacher Eligibility Test Result (Demo)", organization: "Demo Education Department, Rajasthan", examSlug: "demo-teacher-eligibility", date: addDays(today, -2), officialUrl: null, isDemo: true },
  { id: "r2", slug: "demo-graduate-exam-result", title: "Combined Graduate Level Tier-I Result (Demo)", organization: "Demo Staff Selection Board", examSlug: "demo-combined-graduate-exam", date: addDays(today, -6), officialUrl: null, isDemo: true },
];
export const demoAnswerKeys: DiscoveryItem[] = [
  { id: "ak1", slug: "demo-banking-officer-answer-key", title: "Banking Officer Prelims Provisional Answer Key (Demo)", organization: "Demo Public Sector Bank", examSlug: "demo-banking-officer-exam", date: addDays(today, -2), officialUrl: null, note: "Objection window as stated on the official site.", isDemo: true },
];
export const demoCalendar: CalendarEntry[] = [
  { id: "c1", title: "Police Constable Written Exam (Demo)", organization: "Demo State Police Recruitment Board", date: addDays(today, 9), kind: "exam", officialUrl: null, isDemo: true },
  { id: "c2", title: "Banking Officer Prelims (Demo)", organization: "Demo Public Sector Bank", date: addDays(today, 16), kind: "exam", officialUrl: null, isDemo: true },
  { id: "c3", title: "Railway Technician Applications Close (Demo)", organization: "Demo Railway Recruitment Board", date: addDays(today, 15), kind: "application-end", officialUrl: null, isDemo: true },
  { id: "c4", title: "Teacher Eligibility Test (Demo)", organization: "Demo Education Department, Rajasthan", date: null, kind: "exam", officialUrl: null, isDemo: true },
];

export const demoUpdates: SiteUpdate[] = [
  { id: "u1", kind: "job", title: "Combined Graduate Level Recruitment (Demo) notification published", href: "/jobs/demo-graduate-level-combined-recruitment", date: addDays(today, -1), isDemo: true },
  { id: "u2", kind: "admit-card", title: "Police Constable Exam Admit Card released (Demo)", href: "/admit-card", date: addDays(today, -1), isDemo: true },
  { id: "u3", kind: "answer-key", title: "Banking Officer Prelims provisional answer key (Demo)", href: "/answer-key", date: addDays(today, -2), isDemo: true },
  { id: "u4", kind: "result", title: "Teacher Eligibility Test result declared (Demo)", href: "/results", date: addDays(today, -2), isDemo: true },
  { id: "u5", kind: "exam-date", title: "Police Constable written exam date announced (Demo)", href: "/exam-calendar", date: addDays(today, -3), isDemo: true },
  { id: "u6", kind: "application", title: "Railway Technician application form open (Demo)", href: "/jobs/demo-railway-technician-recruitment", date: addDays(today, -4), isDemo: true },
];
