"use client";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="grid gap-4">
      <label className="field">
        <span>Email</span>
        <input className="input" type="email" name="email" autoComplete="username" required defaultValue={state.email} />
      </label>
      <label className="field">
        <span>Password</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-sm text-neg">
          {state.error}
        </p>
      )}
      <button className="btn mt-1 w-full py-2.5" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
