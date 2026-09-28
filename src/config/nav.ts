import type { Reference } from "@/lib/data/ref";

type NavRef = Pick<Reference, "departments" | "qualifications">;

export interface NavLink { label: string; href: string; /** Only shown in the bar from 1280px; below that it moves into "More". */ xlOnly?: boolean }
export interface NavGroup { label: string; href?: string; columns?: { title: string; links: NavLink[] }[]; links?: NavLink[] }

/** Department/qualification links come from the reference tables (database), not from a hard-coded list. */
export const buildPrimaryNav = ({ departments, qualifications }: NavRef): (NavLink | NavGroup)[] => [
  {
    label: "Government Jobs",
    href: "/jobs",
    columns: [
      { title: "By Department", links: departments.slice(0, 9).map((d) => ({ label: d.name, href: `/department/${d.slug}` })) },
      { title: "By Qualification", links: qualifications.slice(0, 6).map((q) => ({ label: q.name, href: `/qualification/${q.slug}` })) },
      { title: "By Level", links: [
        { label: "Central Government", href: "/central-jobs" },
        { label: "State Government", href: "/state" },
        { label: "All Departments", href: "/department" },
        { label: "All Qualifications", href: "/qualification" },
      ] },
    ],
  },
  { label: "Latest Jobs", href: "/jobs" },
  { label: "State Jobs", href: "/state" },
  { label: "Central Jobs", href: "/central-jobs", xlOnly: true },
  { label: "Admit Card", href: "/admit-card" },
  { label: "Results", href: "/results" },
  { label: "Answer Key", href: "/answer-key" },
  { label: "Syllabus", href: "/exams", xlOnly: true },
  { label: "Exam Calendar", href: "/exam-calendar" },
  { label: "Preparation", href: "/preparation", xlOnly: true },
  {
    label: "More",
    links: [
      { label: "Central Jobs", href: "/central-jobs", xlOnly: true },
      { label: "Syllabus", href: "/exams", xlOnly: true },
      { label: "Preparation", href: "/preparation", xlOnly: true },
      { label: "About Us", href: "/about" },
      { label: "Editorial Policy", href: "/editorial-policy" },
      { label: "Correction Policy", href: "/correction-policy" },
      { label: "Contact", href: "/contact" },
      { label: "Site Map", href: "/site-map" },
    ],
  },
];

export const buildFooterColumns = ({ qualifications }: NavRef): { title: string; links: NavLink[] }[] => [
  { title: "Find Jobs", links: [
    { label: "Government Jobs", href: "/jobs" },
    { label: "Latest Jobs", href: "/jobs" },
    { label: "State Jobs", href: "/state" },
    { label: "Central Jobs", href: "/central-jobs" },
    { label: "Departments", href: "/department" },
  ] },
  { title: "Exams & Results", links: [
    { label: "Admit Card", href: "/admit-card" },
    { label: "Results", href: "/results" },
    { label: "Answer Key", href: "/answer-key" },
    { label: "Exam Calendar", href: "/exam-calendar" },
    { label: "Preparation", href: "/preparation" },
  ] },
  { title: "Popular Qualifications", links: qualifications.slice(0, 6).map((q) => ({ label: q.name, href: `/qualification/${q.slug}` })) },
  { title: "Company", links: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Advertise", href: "/advertise" },
    { label: "Editorial Policy", href: "/editorial-policy" },
    { label: "Correction Policy", href: "/correction-policy" },
    { label: "Sitemap", href: "/site-map" },
  ] },
];

export const legalLinks: NavLink[] = [
  { label: "Disclaimer", href: "/disclaimer" },
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms & Conditions", href: "/terms" },
];

export const popularSearches = ["SSC", "Police", "10th Pass", "Delhi", "Railway", "Anganwadi", "Teacher"];
