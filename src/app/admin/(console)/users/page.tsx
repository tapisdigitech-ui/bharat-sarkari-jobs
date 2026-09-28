import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/staff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ROLES, allActions, permissions, roleLabels, type Role } from "@/lib/admin/permissions";
import { formatDateTimeIST } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Users & roles" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireStaff("users:manage");
  const db = await createSupabaseServerClient();
  const [staff, profiles] = await Promise.all([
    db.from("admin_users").select("user_id,role,active,created_at").order("created_at"),
    db.from("profiles").select("id,display_name"),
  ]);
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.display_name as string | null]));
  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-extrabold">Users &amp; roles</h1>
        <p className="text-sm text-ink-muted">Read-only in this phase. Staff accounts are created with <code>npm run admin:create</code>; in-app user management arrives in a later phase. Role changes made directly in the database are audited and guarded (only a super admin can touch super admins, and the last one cannot be removed).</p></div>
      <section aria-labelledby="staff-h">
        <h2 id="staff-h" className="section-title mb-2">Staff</h2>
        {staff.error ? <p role="alert" className="text-danger-700">{staff.error.message}</p> : (
          <div className="table-wrap bg-white" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="data-table"><caption className="sr-only">Staff accounts</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">User ID</th><th scope="col">Role</th><th scope="col">Active</th><th scope="col">Added</th></tr></thead>
            <tbody>{(staff.data ?? []).map((u) => <tr key={u.user_id}><td>{names.get(u.user_id) || "—"}</td><td><code>{u.user_id.slice(0, 8)}</code></td><td>{roleLabels[u.role as Role] ?? u.role}</td><td>{u.active ? "Yes" : "No"}</td><td className="text-sm">{formatDateTimeIST(u.created_at)}</td></tr>)}</tbody></table></div>
        )}
      </section>
      <section aria-labelledby="matrix-h">
        <h2 id="matrix-h" className="section-title mb-2">Permission matrix</h2>
        <div className="table-wrap bg-white" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)"><table className="data-table"><caption className="sr-only">Permissions by role</caption>
          <thead><tr><th scope="col">Permission</th>{ROLES.map((r) => <th key={r} scope="col">{roleLabels[r]}</th>)}</tr></thead>
          <tbody>{allActions.map((a) => <tr key={a}><td><code>{a}</code></td>{ROLES.map((r) => <td key={r} className="text-center">{permissions[r].includes(a) ? <><span aria-hidden="true">✓</span><span className="sr-only">Allowed</span></> : <><span aria-hidden="true" className="text-ink-muted">–</span><span className="sr-only">Not allowed</span></>}</td>)}</tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
