"use client";

import { useActionState, useState } from "react";
import { addAdmin, changeMyPassword, removeAdminAction, type TeamState } from "./actions";

function Status({ s }: { s: TeamState }) {
  if (s.error) return <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-sm text-neg">{s.error}</p>;
  if (s.ok && !s.password) return <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{s.ok}</p>;
  return null;
}

export function AddAdminForm() {
  const [s, action, pending] = useActionState<TeamState, FormData>(addAdmin, {});
  const [copied, setCopied] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const text = s.email && s.password ? `Sign in at ${typeof window !== "undefined" ? window.location.origin : ""}\nEmail: ${s.email}\nPassword: ${s.password}` : "";
  return (
    <div className="grid gap-4">
      {s.password && s.email ? (
        <div role="status" className="rounded-xl border border-accent/40 bg-accent-soft/60 p-4 text-sm">
          <p className="font-medium">{s.ok} Send them these details. The password won’t be shown again.</p>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-3 font-sans">{text}</pre>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-quiet py-1.5" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
              {copied ? "Copied" : "Copy login details"}
            </button>
            <button type="button" className="btn btn-quiet py-1.5" onClick={() => { setFormKey((k) => k + 1); setCopied(false); }}>Add another admin</button>
          </div>
        </div>
      ) : null}
      {(!s.password || formKey > 0) && (
        <form key={formKey} action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="field"><span>Email</span>
            <input className="input" type="email" name="email" required autoComplete="off" placeholder="name@aimexstudio.co.za" /></label>
          <label className="field"><span>Password</span>
            <input className="input" type="text" name="password" minLength={10} autoComplete="new-password" placeholder="Leave blank to generate one" /></label>
          <button className="btn" disabled={pending}>{pending ? "Adding…" : "Add admin"}</button>
          <div className="sm:col-span-3"><Status s={s.password ? {} : s} /></div>
        </form>
      )}
    </div>
  );
}

export function RemoveAdminButton({ userId, email }: { userId: string; email: string }) {
  return (
    <form action={removeAdminAction}
      onSubmit={(e) => { if (!confirm(`Remove ${email} as an admin? They’ll be signed out straight away and won’t be able to sign in again.`)) e.preventDefault(); }}>
      <input type="hidden" name="userId" value={userId} />
      <button className="text-sm font-medium text-neg hover:underline">Remove</button>
    </form>
  );
}

export function ChangeMyPasswordForm() {
  const [s, action, pending] = useActionState<TeamState, FormData>(changeMyPassword, {});
  return (
    <form action={action} className="grid gap-4 sm:max-w-md">
      <label className="field"><span>Current password</span>
        <input className="input" type="password" name="current" required autoComplete="current-password" /></label>
      <label className="field"><span>New password</span>
        <input className="input" type="password" name="next" required minLength={10} autoComplete="new-password" /></label>
      <label className="field"><span>New password again</span>
        <input className="input" type="password" name="confirm" required minLength={10} autoComplete="new-password" /></label>
      <Status s={s} />
      <div><button className="btn btn-quiet" disabled={pending}>{pending ? "Changing…" : "Change my password"}</button></div>
    </form>
  );
}
