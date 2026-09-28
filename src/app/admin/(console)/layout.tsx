import { requireStaff } from "@/lib/auth/staff";
import { can, roleLabels, VERBS, type Action } from "@/lib/admin/permissions";
import { AdminShell, type NavItem } from "@/components/admin/AdminShell";
import { signOutAction } from "../login/actions";

/** Every page below this layout requires a verified, active staff member (also enforced again in each page/action and by RLS). */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const r = staff.role;
  const anyJob = (["job:create", "job:edit", "job:review", "job:publish", "job:unpublish", "job:expire"] as const).some((a) => can(r, a));
  const ref = can(r, "reference:manage");
  const anyOf = (role: typeof r, k: string) => VERBS.some((v) => can(role, `${k}:${v}` as Action));
  const items: NavItem[] = [
    { label: "Dashboard", href: "/admin" },
    ...(anyJob ? [{ label: "Jobs", href: "/admin/jobs" }] : []),
    ...(anyOf(r, "recruitment") ? [{ label: "Recruitments", href: "/admin/recruitments" }] : []),
    ...(anyOf(r, "exam") ? [{ label: "Exams", href: "/admin/exams" }] : []),
    ...(anyOf(r, "admit_card") ? [{ label: "Admit Cards", href: "/admin/admit-cards" }] : []),
    ...(anyOf(r, "result") ? [{ label: "Results", href: "/admin/results" }] : []),
    ...(anyOf(r, "answer_key") ? [{ label: "Answer Keys", href: "/admin/answer-keys" }] : []),
    ...(anyOf(r, "exam_calendar") ? [{ label: "Exam Calendar", href: "/admin/exam-calendar" }] : []),
    // Content operations (Phase 3): every staff member can see the registry, the queue, the log and the health screen;
    // what they can DO there is decided per action (source:manage, ingestion:run, ingestion:review) and by the database.
    { label: "Review Queue", href: "/admin/review" }, { label: "Sources", href: "/admin/sources" },
    { label: "Ingestion Log", href: "/admin/ingestion" }, { label: "Content Health", href: "/admin/health" },
    ...(can(r, "ingestion:run") ? [{ label: "CSV Import", href: "/admin/import" }] : []),
    ...(ref ? [
      { label: "Organizations", href: "/admin/organizations" }, { label: "Departments", href: "/admin/departments" },
      { label: "States", href: "/admin/states" }, { label: "Districts", href: "/admin/districts" },
      { label: "Qualifications", href: "/admin/qualifications" }, { label: "Job Categories", href: "/admin/categories" },
      { label: "Reservation categories", href: "/admin/reservation-categories" },
      { label: "Result types", href: "/admin/result-types" }, { label: "Answer key types", href: "/admin/answer-key-types" },
    ] : []),
    ...(can(r, "users:manage") ? [{ label: "Users", href: "/admin/users" }] : []),
    { label: "Alerts", soon: true },
    ...(can(r, "audit:view") ? [{ label: "Audit Logs", href: "/admin/audit" }] : []),
    { label: "Settings", soon: true },
  ];
  return <AdminShell items={items} who={staff.user.email ?? "Staff"} roleLabel={roleLabels[r]} signOut={signOutAction}>{children}</AdminShell>;
}
