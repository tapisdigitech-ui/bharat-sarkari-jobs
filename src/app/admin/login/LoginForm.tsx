"use client";
import { useActionState } from "react";
import { signInAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-semibold">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-semibold">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state.error && <p role="alert" data-testid="login-error" className="rounded-md border border-danger-600/30 bg-danger-50 px-3 py-2 text-sm text-danger-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary w-full disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
