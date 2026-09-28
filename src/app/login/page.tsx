import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata = buildMetadata({ title: "Login", description: "Account access for saved jobs and alerts (coming soon).", path: "/login", noindex: true });

export default function Page() {
  const isRegister = false as boolean;
  return (
    <div className="container-page max-w-md py-8">
      <Breadcrumbs items={[{ name: "Login", href: "/login" }]} />
      <h1 className="mb-2 mt-3 text-2xl font-extrabold">Login</h1>
      <p role="note" className="mb-4 rounded-lg border border-warning-700/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">Accounts are not connected yet (Supabase Auth is planned). This form is a preview and cannot sign you in.</p>
      <form className="card space-y-4 p-5" aria-label="Login (preview)">
        <fieldset disabled className="space-y-4">
          {isRegister && <div><label htmlFor="name" className="mb-1 block text-sm font-semibold">Name</label><input id="name" className="input" autoComplete="name" /></div>}
          <div><label htmlFor="email" className="mb-1 block text-sm font-semibold">Email</label><input id="email" type="email" className="input" autoComplete="email" /></div>
          <div><label htmlFor="password" className="mb-1 block text-sm font-semibold">Password</label><input id="password" type="password" className="input" autoComplete={isRegister ? "new-password" : "current-password"} /></div>
          <button type="button" className="btn btn-primary w-full opacity-60">{isRegister ? "Create account" : "Login"}</button>
        </fieldset>
      </form>
    </div>
  );
}
