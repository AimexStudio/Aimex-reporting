"use client";

import { useActionState, useState, useTransition } from "react";
import type { Goal, Milestone, SalesRow, SalesSnapshot, SectionNotes } from "@/db/types";
import { DEFAULT_STATUSES, statusColor } from "@/lib/sales";
import { monthLabel } from "@/lib/metrics";
import {
  addClientUserAction, changeClientUserRole, deleteSalesAction, removeClientUserAction, resetClientPassword, saveGoalActualsAction, saveSalesAction,
  saveReportSettingsAction, saveSectionNotesAction, setLogoAction, type FormState,
} from "../actions";

const say = (s: FormState) =>
  s.error ? <span role="alert" className="text-sm text-neg">{s.error}</span> : s.ok ? <span role="status" className="text-sm text-accent">{s.ok}</span> : null;

function Credentials({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Sign in at ${typeof window !== "undefined" ? window.location.origin : ""}\nEmail: ${email}\nPassword: ${password}`;
  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft/60 p-4 text-sm">
      <p className="font-medium">Send these details. The password won’t be shown again.</p>
      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface p-3 font-sans">{text}</pre>
      <button type="button" className="btn btn-quiet mt-2 py-1.5" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
        {copied ? "Copied" : "Copy login details"}
      </button>
    </div>
  );
}

/* ================= logins (super admin) ================= */

export function AddLoginForm({ clientId }: { clientId: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(addClientUserAction, {});
  const [k, setK] = useState(0);
  return (
    <div className="grid gap-3">
      {s.password && s.email && <Credentials key={s.email} email={s.email} password={s.password} />}
      <form key={k} action={(fd) => { action(fd); setK((x) => x + 1); }} className="grid gap-3 sm:grid-cols-[1fr_150px_1fr_auto] sm:items-end">
        <input type="hidden" name="clientId" value={clientId} />
        <label className="field"><span>Email</span><input className="input" type="email" name="email" required autoComplete="off" /></label>
        <label className="field"><span>Permission</span>
          <select className="input" name="role" defaultValue="client">
            <option value="client">Viewer</option>
            <option value="client_admin">Admin</option>
          </select>
        </label>
        <label className="field"><span>Password</span><input className="input" name="password" minLength={10} placeholder="Leave blank to generate" autoComplete="new-password" /></label>
        <button className="btn" disabled={pending}>{pending ? "Adding…" : "Add login"}</button>
      </form>
      {!s.password && say(s)}
    </div>
  );
}

export function RoleSelect({ clientId, userId, role }: { clientId: string; userId: string; role: string }) {
  const [pending, start] = useTransition();
  return (
    <select aria-label="Permission" className="input w-auto py-1 text-sm" defaultValue={role} disabled={pending}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("clientId", clientId); fd.set("userId", userId); fd.set("role", e.target.value);
        start(() => changeClientUserRole(fd));
      }}>
      <option value="client">Viewer</option>
      <option value="client_admin">Admin</option>
    </select>
  );
}

export function RemoveLoginButton({ clientId, userId, email }: { clientId: string; userId: string; email: string }) {
  return (
    <form action={removeClientUserAction} onSubmit={(e) => { if (!confirm(`Remove ${email}? They’ll be signed out and won’t be able to sign in again.`)) e.preventDefault(); }}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="userId" value={userId} />
      <button className="text-sm font-medium text-neg hover:underline">Remove</button>
    </form>
  );
}

export function ResetLoginPassword({ clientId, userId }: { clientId: string; userId: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(resetClientPassword, {});
  if (s.password && s.email) return <Credentials email={s.email} password={s.password} />;
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="userId" value={userId} />
      <button className="text-sm font-medium text-brand-strong hover:underline" disabled={pending}>{pending ? "Resetting…" : "New password"}</button>
      {s.error && <span className="ml-2 text-sm text-neg">{s.error}</span>}
    </form>
  );
}

/* ================= insights, warnings and goal figures for a month ================= */

export function MonthContentEditor({ clientId, dashboardId, month, sections, notes, manualGoals, actuals }: {
  clientId: string; dashboardId: string; month: string; sections: string[];
  notes: Record<string, SectionNotes>; manualGoals: Goal[]; actuals: Record<string, number>;
}) {
  const [section, setSection] = useState(sections[0]);
  const [s, action, pending] = useActionState<FormState, FormData>(saveSectionNotesAction, {});
  const [g, gAction, gPending] = useActionState<FormState, FormData>(saveGoalActualsAction, {});
  const n = notes[section];
  return (
    <details className="rounded-xl border border-line bg-page/50 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Insights and warnings{Object.keys(notes).length ? ` (${Object.keys(notes).length} written)` : ""}{manualGoals.length ? ", goal figures" : ""}
      </summary>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {sections.map((x) => (
          <button key={x} type="button" onClick={() => setSection(x)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${x === section ? "bg-night text-white" : "bg-line-soft hover:bg-line"}`}>
            {x === "overview" ? "Overview" : x}{notes[x] ? " ✓" : ""}
          </button>
        ))}
      </div>
      <form key={section} action={action} className="mt-3 grid gap-3">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="dashboardId" value={dashboardId} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="section" value={section} />
        <label className="field"><span>Insights, one per line. Start with “Title:” to make the title bold.</span>
          <textarea className="input min-h-28 text-sm" name="insights" defaultValue={n?.insights.join("\n") ?? ""}
            placeholder={"High retargeting frequency (4.17): buyers are seeing the ads often, which keeps Buh-Rein top of mind.\nLow-cost blog traffic: R 1.72 per visit builds the retargeting audience."} /></label>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="field"><span>Warning title (optional)</span>
            <input className="input text-sm" name="alertTitle" defaultValue={n?.alertTitle ?? ""} placeholder="Google policy: eligible (limited)" /></label>
          <label className="field"><span>Warning details</span>
            <textarea className="input min-h-16 text-sm" name="alertBody" defaultValue={n?.alertBody ?? ""} placeholder="What’s happening and what we’re doing about it." /></label>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn btn-quiet py-1.5" disabled={pending}>{pending ? "Saving…" : `Save ${section === "overview" ? "overview" : section} notes`}</button>
          {say(s)}
        </div>
      </form>
      {manualGoals.length > 0 && (
        <form action={gAction} className="mt-4 grid gap-3 border-t border-line pt-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="dashboardId" value={dashboardId} />
          <input type="hidden" name="month" value={month} />
          <p className="text-sm font-medium">Goal figures entered by hand</p>
          <div className="flex flex-wrap gap-3">
            {manualGoals.map((goal) => (
              <label key={goal.id} className="field w-40"><span>{goal.label}</span>
                <input className="input py-1.5" name={`goal:${goal.id}`} inputMode="decimal" defaultValue={actuals[goal.id] ?? ""} /></label>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button className="btn btn-quiet py-1.5" disabled={gPending}>{gPending ? "Saving…" : "Save goal figures"}</button>
            {say(g)}
          </div>
        </form>
      )}
    </details>
  );
}

/* ================= report settings: benchmark, goals, roadmap, planner ================= */

const GOAL_METRICS: [string, string][] = [
  ["leads", "Leads"], ["cpl", "Cost per lead"], ["conversions", "Conversions"], ["cpa", "Cost per conversion"],
  ["spend", "Ad spend"], ["revenue", "Revenue"], ["roas", "Return on ad spend"], ["clicks", "Clicks"], ["ctr", "Click-through rate"],
  ["impressions", "Impressions"], ["sessions", "Website sessions"],
];

export function ReportSettingsForm({ clientId, dashboardId, settings }: {
  clientId: string; dashboardId: string;
  settings: { benchmark?: { min: number | null; max: number | null; label: string } | null; goals?: Goal[]; milestones?: Milestone[]; roi?: { saleNoun: string; avgSaleValue: number | null; rate: number | null } | null };
}) {
  const [s, action, pending] = useActionState<FormState, FormData>(saveReportSettingsAction, {});
  const [goals, setGoals] = useState<Goal[]>(settings.goals ?? []);
  const [ms, setMs] = useState<Milestone[]>(settings.milestones ?? []);
  const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));
  const setG = (i: number, p: Partial<Goal>) => setGoals(goals.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const setM = (i: number, p: Partial<Milestone>) => setMs(ms.map((m, j) => (j === i ? { ...m, ...p } : m)));
  return (
    <form action={action} className="grid gap-8">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <input type="hidden" name="goals" value={JSON.stringify(goals)} />
      <input type="hidden" name="milestones" value={JSON.stringify(ms)} />

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-semibold">Market benchmark for cost per result</legend>
        <p className="-mt-1 text-sm text-ink-2">Shown next to the cost per lead, e.g. “Below the R 120–R 200 Cape Town property range”.</p>
        <div className="grid gap-3 sm:grid-cols-[140px_140px_1fr]">
          <label className="field"><span>From (R)</span><input className="input" name="benchMin" inputMode="decimal" defaultValue={settings.benchmark?.min ?? ""} /></label>
          <label className="field"><span>To (R)</span><input className="input" name="benchMax" inputMode="decimal" defaultValue={settings.benchmark?.max ?? ""} /></label>
          <label className="field"><span>Describes</span><input className="input" name="benchLabel" defaultValue={settings.benchmark?.label ?? ""} placeholder="Cape Town property" maxLength={80} /></label>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-semibold">Goals</legend>
        <p className="-mt-1 text-sm text-ink-2">Monthly targets with progress bars. Choose a figure from the uploads, or “Entered by hand” for things like reservations, then fill those in per month below.</p>
        {goals.map((g, i) => (
          <div key={g.id} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1.4fr_1.2fr_120px_110px_auto] sm:items-end">
            <label className="field"><span>Name</span><input className="input py-1.5" value={g.label} onChange={(e) => setG(i, { label: e.target.value })} placeholder="Reservations" /></label>
            <label className="field"><span>Figure</span>
              <select className="input py-1.5" value={g.metric ?? ""} onChange={(e) => setG(i, { metric: e.target.value || null })}>
                <option value="">Entered by hand</option>
                {GOAL_METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
            <label className="field"><span>Target</span>
              <select className="input py-1.5" value={g.direction} onChange={(e) => setG(i, { direction: e.target.value as Goal["direction"] })}>
                <option value="atLeast">At least</option>
                <option value="atMost">At most</option>
              </select></label>
            <label className="field"><span>Value</span><input className="input py-1.5" inputMode="decimal" value={Number.isFinite(g.target) ? g.target : ""} onChange={(e) => setG(i, { target: Number(e.target.value) })} /></label>
            <button type="button" className="text-sm text-neg hover:underline" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="justify-self-start text-sm font-medium text-brand-strong hover:underline"
          onClick={() => setGoals([...goals, { id: newId(), label: "", metric: "leads", target: 0, direction: "atLeast" }])}>+ Add goal</button>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-semibold">Project roadmap</legend>
        {ms.map((m, i) => (
          <div key={m.id} className="grid gap-2 rounded-xl border border-line p-3">
            <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_140px_auto] sm:items-end">
              <label className="field"><span>Milestone</span><input className="input py-1.5" value={m.title} onChange={(e) => setM(i, { title: e.target.value })} placeholder="Phase II sales launch" /></label>
              <label className="field"><span>When</span><input className="input py-1.5" value={m.when} onChange={(e) => setM(i, { when: e.target.value })} placeholder="May – June 2026" /></label>
              <label className="field"><span>Status</span>
                <select className="input py-1.5" value={m.status} onChange={(e) => setM(i, { status: e.target.value as Milestone["status"] })}>
                  <option value="done">Done</option><option value="current">In progress</option><option value="upcoming">Planned</option>
                </select></label>
              <button type="button" className="text-sm text-neg hover:underline" onClick={() => setMs(ms.filter((_, j) => j !== i))}>Remove</button>
            </div>
            <label className="field"><span>Description</span><textarea className="input min-h-14 py-1.5 text-sm" value={m.description} onChange={(e) => setM(i, { description: e.target.value })} /></label>
          </div>
        ))}
        <button type="button" className="justify-self-start text-sm font-medium text-brand-strong hover:underline"
          onClick={() => setMs([...ms, { id: newId(), title: "", when: "", description: "", status: "upcoming" }])}>+ Add milestone</button>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-semibold">ROI planner starting values</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field"><span>What a sale is called</span><input className="input" name="roiNoun" defaultValue={settings.roi?.saleNoun ?? ""} placeholder="reservations" maxLength={40} /></label>
          <label className="field"><span>Average sale value (R)</span><input className="input" name="roiValue" inputMode="decimal" defaultValue={settings.roi?.avgSaleValue ?? ""} placeholder="2100000" /></label>
          <label className="field"><span>Lead-to-sale rate (%)</span><input className="input" name="roiRate" inputMode="decimal" defaultValue={settings.roi?.rate ?? ""} placeholder="1" /></label>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save report settings"}</button>
        {say(s)}
      </div>
    </form>
  );
}

/* ================= client logo ================= */

export function LogoForm({ clientId, logo }: { clientId: string; logo: string | null }) {
  const [preview, setPreview] = useState(logo);
  const [msg, setMsg] = useState<FormState>({});
  const [pending, start] = useTransition();

  async function pick(file: File | undefined) {
    if (!file) return;
    // Shrink to at most 480×200 so it stays small in the database and sharp in the sidebar.
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 480 / img.width, 200 / img.height);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/png");
    setPreview(url);
    start(async () => setMsg(await setLogoAction({ clientId, dataUrl: url })));
  }
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid h-20 w-48 place-items-center rounded-xl bg-night p-2">
        {preview ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview} alt="Client logo" className="max-h-16 max-w-full rounded bg-white/95 object-contain p-1" />
          : <span className="text-xs text-white/50">No logo yet</span>}
      </div>
      <div className="grid gap-2">
        <input type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" onChange={(e) => pick(e.target.files?.[0])} disabled={pending} />
        {preview && (
          <button type="button" className="justify-self-start text-sm text-neg hover:underline" disabled={pending}
            onClick={() => { setPreview(null); start(async () => setMsg(await setLogoAction({ clientId, dataUrl: null }))); }}>Remove logo</button>
        )}
        {pending ? <span className="text-sm text-ink-3">Saving…</span> : say(msg)}
      </div>
    </div>
  );
}

/* ================= sales figures entered by hand ================= */

type EditRow = { status: string; units: string; value: string; size: string };
const toEdit = (rows: SalesRow[]): EditRow[] => rows.map((r) => ({ status: r.status, units: String(r.units), value: r.value == null ? "" : String(r.value), size: r.size == null ? "" : String(r.size) }));
const blankRows = (): EditRow[] => DEFAULT_STATUSES.map((status) => ({ status, units: "", value: "", size: "" }));
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function SalesForm({ clientId, dashboardId, sales }: { clientId: string; dashboardId: string; sales: Record<string, SalesSnapshot> }) {
  const saved = Object.keys(sales).sort().reverse();
  const latest = saved[0] ? sales[saved[0]] : null;
  const [month, setMonth] = useState(thisMonth());
  // A new month starts from the latest figures, so only what changed needs typing.
  const [rows, setRows] = useState<EditRow[]>(sales[thisMonth()] ? toEdit(sales[thisMonth()].rows) : latest ? toEdit(latest.rows) : blankRows());
  const [s, action, pending] = useActionState<FormState, FormData>(saveSalesAction, {});
  const set = (i: number, p: Partial<EditRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const load = (m: string) => { setMonth(m); if (sales[m]) setRows(toEdit(sales[m].rows)); };
  const n = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
  const totals = { units: rows.reduce((t, r) => t + n(r.units), 0), value: rows.reduce((t, r) => t + n(r.value), 0), size: rows.reduce((t, r) => t + n(r.size), 0) };
  const payload = JSON.stringify(rows.map((r) => ({ status: r.status, units: n(r.units), value: r.value.trim() ? n(r.value) : null, size: r.size.trim() ? n(r.size) : null })));
  const fmt = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v).replace(/,/g, "\u00a0");

  return (
    <div className="grid gap-6">
      <form action={action} className="grid gap-4">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="dashboardId" value={dashboardId} />
        <input type="hidden" name="rows" value={payload} />
        <label className="field w-48"><span>Month</span>
          <input className="input" type="month" name="month" value={month} required onChange={(e) => load(e.target.value)} /></label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-ink-2">
                <th className="py-1.5 pr-2 font-medium">Status</th>
                <th className="px-2 py-1.5 text-right font-medium">Units</th>
                <th className="px-2 py-1.5 text-right font-medium">Value (R)</th>
                <th className="px-2 py-1.5 text-right font-medium">Size (m²)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="size-3 shrink-0 rounded-full" style={{ background: statusColor(r.status || "x", i) }} />
                      <input className="input py-1.5" value={r.status} onChange={(e) => set(i, { status: e.target.value })} aria-label="Status" />
                    </div>
                  </td>
                  <td className="px-2 py-1"><input className="input w-24 py-1.5 text-right" inputMode="numeric" value={r.units} onChange={(e) => set(i, { units: e.target.value })} aria-label={`${r.status} units`} /></td>
                  <td className="px-2 py-1"><input className="input w-40 py-1.5 text-right" inputMode="decimal" value={r.value} onChange={(e) => set(i, { value: e.target.value })} aria-label={`${r.status} value`} /></td>
                  <td className="px-2 py-1"><input className="input w-28 py-1.5 text-right" inputMode="decimal" value={r.size} onChange={(e) => set(i, { size: e.target.value })} aria-label={`${r.status} size`} /></td>
                  <td className="py-1 pl-2"><button type="button" className="text-sm text-neg hover:underline" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-2 pr-2">Total</td>
                <td className="px-2 py-2 text-right">{fmt(totals.units)}</td>
                <td className="px-2 py-2 text-right">{totals.value ? `R ${fmt(totals.value)}` : "–"}</td>
                <td className="px-2 py-2 text-right">{totals.size ? `${fmt(totals.size)} m²` : "–"}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <button type="button" className="justify-self-start text-sm font-medium text-brand-strong hover:underline"
          onClick={() => setRows([...rows, { status: "", units: "", value: "", size: "" }])}>+ Add status</button>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" disabled={pending}>{pending ? "Saving…" : `Save figures for ${monthLabel(month)}`}</button>
          {say(s)}
        </div>
        <p className="text-sm text-ink-3">Leave value or size blank if you don’t track it; those columns are then hidden in the report. A new month starts from the latest saved figures.</p>
      </form>

      {saved.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Saved months</p>
          <ul className="divide-y divide-line-soft rounded-xl border border-line">
            {saved.map((m) => {
              const u = sales[m].rows.reduce((t, r) => t + r.units, 0);
              return (
                <li key={m} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span><strong>{monthLabel(m)}</strong> <span className="text-ink-3">{u} units, {sales[m].rows.map((r) => `${r.status} ${r.units}`).join(", ")}</span></span>
                  <span className="flex gap-4">
                    <button type="button" className="font-medium text-brand-strong hover:underline" onClick={() => load(m)}>Edit</button>
                    <form action={deleteSalesAction} onSubmit={(e) => { if (!confirm(`Delete the sales figures for ${monthLabel(m)}?`)) e.preventDefault(); }}>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="dashboardId" value={dashboardId} />
                      <input type="hidden" name="month" value={m} />
                      <button className="text-neg hover:underline">Delete</button>
                    </form>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
