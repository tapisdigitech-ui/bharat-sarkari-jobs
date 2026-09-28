/**
 * Role/permission matrix — the TypeScript mirror of the database tables `role_permissions` and
 * `workflow_transitions`. The DATABASE is the enforcement point (RLS + triggers); this file drives UI and
 * friendly server-side pre-checks, and is used to GENERATE the seed SQL (scripts/gen-sql.ts).
 * A test (tests/rls.test.ts) verifies the two never drift apart.
 */
export type Role = "super_admin" | "admin" | "editor" | "content_manager" | "seo_manager" | "moderator";
export type ContentStatus = "draft" | "review" | "published" | "updated" | "expired" | "archived";

export const ROLES: Role[] = ["super_admin", "admin", "editor", "content_manager", "seo_manager", "moderator"];

export const roleLabels: Record<Role, string> = {
  super_admin: "Super Admin", admin: "Admin", editor: "Editor", content_manager: "Content Manager", seo_manager: "SEO Manager", moderator: "Moderator",
};

/** Editorial content types that share ONE workflow (draft → review → published → updated/expired → archived). */
export const CONTENT_KINDS = ["job", "recruitment", "exam", "admit_card", "result", "answer_key", "exam_calendar"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const kindLabels: Record<ContentKind, string> = {
  job: "Job", recruitment: "Recruitment", exam: "Exam", admit_card: "Admit card", result: "Result", answer_key: "Answer key", exam_calendar: "Exam calendar entry",
};

export const VERBS = ["create", "edit", "review", "publish", "unpublish", "expire", "delete"] as const;
export type Verb = (typeof VERBS)[number];
type ContentAction = `${ContentKind}:${Verb}`;
type OtherAction = "job:schedule" | "reference:manage" | "articles:manage" | "seo:manage" | "homepage:manage" | "alerts:manage" | "users:manage" | "analytics:view" | "audit:view" | "ingestion:review" | "ingestion:run" | "source:manage";
export type Action = ContentAction | OtherAction;

const contentActions = (kinds: readonly ContentKind[], verbs: readonly Verb[]): Action[] => kinds.flatMap((k) => verbs.map((v) => `${k}:${v}` as Action));

export const allActions: readonly Action[] = [
  ...contentActions(CONTENT_KINDS, VERBS), "job:schedule",
  "reference:manage", "articles:manage", "seo:manage", "homepage:manage", "alerts:manage", "users:manage", "analytics:view", "audit:view", "ingestion:review",
  "ingestion:run", "source:manage",
];

export const permissions: Record<Role, readonly Action[]> = {
  super_admin: allActions,
  admin: allActions,
  // Editors run the whole editorial pipeline for every content type (jobs additionally may be scheduled).
  editor: [...contentActions(CONTENT_KINDS, VERBS), "job:schedule", "articles:manage", "ingestion:review", "ingestion:run", "analytics:view"],
  // Content managers write and edit but cannot publish; they also curate reference data.
  // They also run the source registry (sources are reference data) and may trigger checks and review discoveries — but approving
  // a LOW-confidence discovery needs publish permission, which they do not have (enforced in approve_discovery).
  content_manager: [...contentActions(CONTENT_KINDS, ["create", "edit"]), "reference:manage", "articles:manage", "ingestion:review", "ingestion:run", "source:manage"],
  seo_manager: ["seo:manage", "homepage:manage", "articles:manage", "analytics:view"],
  // Moderators review, take down and expire, and read the audit log.
  moderator: [...contentActions(CONTENT_KINDS, ["review", "unpublish", "expire"]), "audit:view", "alerts:manage"],
};

export const can = (role: Role | null | undefined, action: Action) => !!role && permissions[role].includes(action);

/** Legal status transitions per kind and the permission each requires (mirrors table workflow_transitions). */
const transitionTemplate: { from: ContentStatus; to: ContentStatus; verb: Verb; label: string }[] = [
  { from: "draft", to: "review", verb: "edit", label: "Submit for review" },
  { from: "review", to: "draft", verb: "review", label: "Send back to draft" },
  { from: "review", to: "published", verb: "publish", label: "Publish" },
  { from: "published", to: "draft", verb: "unpublish", label: "Unpublish" },
  { from: "updated", to: "draft", verb: "unpublish", label: "Unpublish" },
  { from: "published", to: "expired", verb: "expire", label: "Mark expired" },
  { from: "updated", to: "expired", verb: "expire", label: "Mark expired" },
  { from: "expired", to: "updated", verb: "publish", label: "Extend & re-publish" },
  { from: "expired", to: "archived", verb: "expire", label: "Archive" },
  { from: "draft", to: "archived", verb: "expire", label: "Archive" },
  { from: "review", to: "archived", verb: "expire", label: "Archive" },
  { from: "archived", to: "draft", verb: "publish", label: "Restore to draft" },
];
export interface Transition { kind: ContentKind; from: ContentStatus; to: ContentStatus; action: Action; label: string }
export const workflow: Transition[] = CONTENT_KINDS.flatMap((kind) => transitionTemplate.map((t) => ({ kind, from: t.from, to: t.to, action: `${kind}:${t.verb}` as Action, label: t.label })));

/** Transitions available to `role` from `status` for one content kind (UI only; the database re-checks). */
export const transitionsFor = (role: Role | null | undefined, status: ContentStatus, kind: ContentKind = "job") =>
  workflow.filter((t) => t.kind === kind && t.from === status && can(role, t.action));

export const isLiveStatus = (s: ContentStatus) => s === "published" || s === "updated";
