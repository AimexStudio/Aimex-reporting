"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createClient, updateClient, resetClientPassword, deleteClient, saveMonthNote, deleteMonth,
  addDashboard, renameDashboardAction, deleteDashboardAction,
  type FormState,
} from "../actions";

const CURRENCIES = ["ZAR", "USD", "GBP", "EUR", "AUD"];

type ClientFields = { id?: string; name?: string; contactName?: string | null; currency?: string; adminNotes?: string | null; email?: string | null };

function Fields({ c, noEmail }: { c: ClientFields; noEmail?: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field"><span>Client name</span>
          <input className="input" name="name" required defaultValue={c.name} placeholder="Harbour & Vine Wine Co." /></label>
        <label className="field"><span>Contact person</span>
          <input className="input" name="contactName" defaultValue={c.contactName ?? ""} placeholder="Optional" /></label>
        {!noEmail && <label className="field"><span>First login email</span>
          <input className="input" type="email" name="email" required defaultValue={c.email ?? ""} autoComplete="off" /></label>}
        <label className="field"><span>Currency</span>
          <select className="input" name="currency" defaultValue={c.currency ?? "ZAR"}>
            {CURRENCIES.map((x) => <option key={x}>{x}</option>)}
          </select></label>
      </div>
      <label className="field"><span>Private notes</span>
        <textarea className="input min-h-20" name="adminNotes" defaultValue={c.adminNotes ?? ""}
          placeholder="Only you can see these. Contract details, reporting quirks…" /></label>
    </>
  );
}

function Status({ s }: { s: FormState }) {
  if (s.error) return <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-sm text-neg">{s.error}</p>;
  if (s.ok) return <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{s.ok}</p>;
  return null;
}

function Credentials({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Email: ${email}\nPassword: ${password}`;
  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft/60 p-4 text-sm">
      <p className="font-medium">Send these login details to the client. The password won’t be shown again.</p>
      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-3 font-sans">{text}</pre>
      <button type="button" className="btn btn-quiet mt-2 py-1.5"
        onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
        {copied ? "Copied" : "Copy login details"}
      </button>
    </div>
  );
}

export function NewClientForm() {
  const [s, action, pending] = useActionState<FormState, FormData>(createClient, {});
  if (s.clientId && s.email && s.password) {
    return (
      <div className="grid gap-4">
        <Status s={s} />
        <Credentials email={s.email} password={s.password} />
        <div className="flex gap-3">
          <Link className="btn" href={`/admin/clients/${s.clientId}`}>Upload their first month</Link>
          <Link className="btn btn-quiet" href="/admin">Back to clients</Link>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-5">
      <Fields c={{}} />
      <label className="field"><span>Password</span>
        <input className="input" name="password" type="text" minLength={10} autoComplete="new-password"
          placeholder="Leave blank to generate a secure one" /></label>
      <Status s={s} />
      <div><button className="btn" disabled={pending}>{pending ? "Creating…" : "Create client"}</button></div>
    </form>
  );
}

export function EditClientForm({ c }: { c: ClientFields }) {
  const [s, action, pending] = useActionState<FormState, FormData>(updateClient, {});
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="clientId" value={c.id} />
      <Fields c={c} noEmail />
      <Status s={s} />
      <div><button className="btn" disabled={pending}>{pending ? "Saving…" : "Save changes"}</button></div>
    </form>
  );
}

export function ResetPasswordForm({ clientId }: { clientId: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(resetClientPassword, {});
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      <label className="field"><span>New password</span>
        <input className="input" name="password" type="text" minLength={10} autoComplete="new-password"
          placeholder="Leave blank to generate one" /></label>
      {s.error && <Status s={s} />}
      {s.password && s.email && <Credentials email={s.email} password={s.password} />}
      <div><button className="btn btn-quiet" disabled={pending}>{pending ? "Changing…" : "Change password"}</button></div>
    </form>
  );
}

export function DeleteClientButton({ clientId, name }: { clientId: string; name: string }) {
  return (
    <form action={deleteClient}
      onSubmit={(e) => { if (!confirm(`Delete ${name}? Their login and every month of data will be permanently removed.`)) e.preventDefault(); }}>
      <input type="hidden" name="clientId" value={clientId} />
      <button className="btn btn-danger">Delete client</button>
    </form>
  );
}

export function MonthNoteForm({ clientId, dashboardId, month, body }: { clientId: string; dashboardId: string; month: string; body: string | null }) {
  const [s, action, pending] = useActionState<FormState, FormData>(saveMonthNote, {});
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <input type="hidden" name="month" value={month} />
      <textarea className="input min-h-16 text-sm" name="body" defaultValue={body ?? ""}
        placeholder="A short note for the client about this month (optional)" />
      <div className="flex items-center gap-3">
        <button className="btn btn-quiet py-1.5" disabled={pending}>{pending ? "Saving…" : "Save note"}</button>
        {s.ok && <span className="text-sm text-accent">{s.ok}</span>}
        {s.error && <span className="text-sm text-neg">{s.error}</span>}
      </div>
    </form>
  );
}

export function DeleteMonthButton({ clientId, dashboardId, month, label }: { clientId: string; dashboardId: string; month: string; label: string }) {
  return (
    <form action={deleteMonth}
      onSubmit={(e) => { if (!confirm(`Remove all ${label} figures for this client?`)) e.preventDefault(); }}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <input type="hidden" name="month" value={month} />
      <button className="text-sm text-neg hover:underline">Remove month</button>
    </form>
  );
}

export function AddDashboardForm({ clientId }: { clientId: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(addDashboard, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" className="rounded-full px-3 py-1.5 text-sm font-medium text-brand-strong ring-1 ring-brand/40 hover:bg-brand-soft" onClick={() => setOpen(true)}>+ Add dashboard</button>;
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input className="input w-56 py-1.5" name="name" required autoFocus placeholder="Sub-company or stream name" maxLength={80} />
      <button className="btn py-1.5" disabled={pending}>{pending ? "Adding…" : "Add"}</button>
      <button type="button" className="btn btn-quiet py-1.5" onClick={() => setOpen(false)}>Cancel</button>
      {s.error && <span className="text-sm text-neg">{s.error}</span>}
    </form>
  );
}

export function RenameDashboardForm({ clientId, dashboardId, name }: { clientId: string; dashboardId: string; name: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(renameDashboardAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <label className="field w-64"><span>Dashboard name</span>
        <input key={name} className="input py-1.5" name="name" required defaultValue={name} maxLength={80} /></label>
      <button className="btn btn-quiet py-1.5" disabled={pending}>{pending ? "Saving…" : "Rename"}</button>
      {s.ok && <span className="text-sm text-accent">{s.ok}</span>}
      {s.error && <span className="text-sm text-neg">{s.error}</span>}
    </form>
  );
}

export function DeleteDashboardButton({ clientId, dashboardId, name }: { clientId: string; dashboardId: string; name: string }) {
  return (
    <form action={deleteDashboardAction}
      onSubmit={(e) => { if (!confirm(`Delete the ${name} dashboard? All its months, notes and upload history will be permanently removed. The client’s other dashboards stay.`)) e.preventDefault(); }}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <button className="btn btn-danger py-1.5">Delete dashboard</button>
    </form>
  );
}
