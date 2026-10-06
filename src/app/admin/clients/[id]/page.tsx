import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientAccess } from "@/lib/auth";
import { getClient, getDashboardData, getDashboards, listClientUsers, listImports } from "@/lib/data";
import { monthLabel, formatMetric } from "@/lib/metrics";
import { UploadPanel } from "../../_components/UploadPanel";
import {
  EditClientForm, DeleteClientButton, MonthNoteForm, DeleteMonthButton,
  AddDashboardForm, RenameDashboardForm, DeleteDashboardButton,
} from "../../_components/ClientForms";
import {
  AddLoginForm, LogoForm, MonthContentEditor, RemoveLoginButton, ReportSettingsForm, ResetLoginPassword, RoleSelect,
} from "../../_components/ReportAdminForms";

export const dynamic = "force-dynamic";

export default async function ClientAdminPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { id } = await params;
  const me = await requireClientAccess(id); // super admins: any client; client admins: only their own
  const isSuper = me.role === "admin";
  const { d } = await searchParams;
  const client = await getClient(id);
  if (!client) notFound();
  const dashboards = await getDashboards(id);
  const dash = dashboards.find((x) => x.id === d) ?? dashboards[0];
  if (!dash) notFound();
  const [users, data, imports] = await Promise.all([listClientUsers(id), getDashboardData(id, dash.id), listImports(id, dash.id)]);
  const login = users[0];
  const manualGoals = (data?.settings.goals ?? []).filter((g) => !g.metric);
  if (!data) notFound();
  const months = [...data.months].reverse();
  const multi = dashboards.length > 1;

  return (
    <div className="grid grid-cols-1 gap-10">
      <div>
        {isSuper ? <Link href="/admin" className="text-sm text-ink-2 hover:underline">‹ Clients</Link>
          : <Link href="/dashboard" className="text-sm text-ink-2 hover:underline">‹ Back to the report</Link>}
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1>
            <p className="mt-1 text-ink-2">
              {isSuper ? `${users.length} login${users.length === 1 ? "" : "s"}, ` : "Managing data as a client admin. "}{dashboards.length} dashboard{multi ? "s" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {multi && <Link href={`/admin/clients/${id}/preview?d=overview`} className="btn btn-quiet">See their overview</Link>}
            <Link href={`/admin/clients/${id}/preview?d=${dash.id}`} className="btn btn-quiet">See {multi ? `the ${dash.name}` : "their"} dashboard</Link>
          </div>
        </div>
      </div>

      <section aria-label="Dashboards" className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">Dashboards</h2>
        <p className="mb-4 mt-0.5 text-sm text-ink-2">
          One per sub-company or stream. {multi ? "The client sees an overview of all of them plus a tab for each." : "Add more if this client has several companies or streams to report on separately."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dashboards.map((x) => (
            <Link key={x.id} href={`/admin/clients/${id}?d=${x.id}`} aria-current={x.id === dash.id ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${x.id === dash.id ? "bg-night text-white" : "bg-line-soft text-ink hover:bg-line"}`}>
              {x.name}
            </Link>
          ))}
          <AddDashboardForm clientId={id} />
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line-soft pt-5">
          <RenameDashboardForm clientId={id} dashboardId={dash.id} name={dash.name} />
          {multi && <DeleteDashboardButton clientId={id} dashboardId={dash.id} name={dash.name} />}
        </div>
      </section>

      <Section title={multi ? `Upload monthly data to ${dash.name}` : "Upload monthly data"} lead="Add a month of results from a CSV. You’ll see a preview before anything is saved.">
        <UploadPanel clientId={id} dashboardId={dash.id} clientName={multi ? dash.name : client.name} existing={data.months.flatMap((m) => m.channels.map((c) => `${m.month}|${c.channel}`))} />
      </Section>

      <Section title={multi ? `Months on file for ${dash.name}` : "Months on file"} lead="The note appears at the top of that month’s report. Insights and warnings appear on the overview or the channel’s page.">
        {months.length === 0 ? (
          <p className="text-ink-2">Nothing uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {months.map((m) => (
              <li key={m.month} className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[220px_1fr]">
                <div>
                  <p className="font-semibold">{monthLabel(m.month)}</p>
                  <p className="text-sm text-ink-2">
                    {m.channels.map((c) => c.channel).join(", ")}
                  </p>
                  {m.totals.spend != null && (
                    <p className="text-sm text-ink-3">{formatMetric("spend", m.totals.spend, client.currency)} spend</p>
                  )}
                  <div className="mt-1"><DeleteMonthButton clientId={id} dashboardId={dash.id} month={m.month} label={monthLabel(m.month)} /></div>
                </div>
                <div className="grid gap-3">
                  <MonthNoteForm clientId={id} dashboardId={dash.id} month={m.month} body={m.note} />
                  <MonthContentEditor clientId={id} dashboardId={dash.id} month={m.month}
                    sections={["overview", ...m.channels.map((c) => c.channel)]} notes={m.sectionNotes}
                    manualGoals={manualGoals} actuals={m.goalActuals} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={multi ? `Report settings for ${dash.name}` : "Report settings"}
        lead="Goals, roadmap, market benchmark and ROI planner values for this report.">
        <ReportSettingsForm key={dash.id} clientId={id} dashboardId={dash.id} settings={data.settings} />
      </Section>

      <Section title="Client logo" lead="Shown at the top of the client’s report sidebar.">
        <LogoForm clientId={id} logo={client.logo ?? null} />
      </Section>

      {isSuper && (
        <Section title="Logins" lead="Viewers see this client’s reports. Admins can also upload data and edit this client’s notes and report settings, but never see other clients.">
          {users.length > 0 && (
            <div className="mb-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-2">
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Permission</th>
                    <th className="hidden py-2 pr-4 font-medium sm:table-cell">Last signed in</th>
                    <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-line-soft align-top last:border-0">
                      <td className="break-all py-3 pr-4 font-medium">{u.email}</td>
                      <td className="py-3 pr-4"><RoleSelect clientId={id} userId={u.id} role={u.role} /></td>
                      <td className="hidden py-3 pr-4 text-ink-2 sm:table-cell">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "Never"}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap justify-end gap-x-4 gap-y-2">
                          <ResetLoginPassword clientId={id} userId={u.id} />
                          <RemoveLoginButton clientId={id} userId={u.id} email={u.email} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AddLoginForm clientId={id} />
        </Section>
      )}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        {isSuper && (
          <Section title="Client details">
            <EditClientForm c={{ ...client, email: login?.email }} />
          </Section>
        )}
        <Section title={multi ? `Upload history for ${dash.name}` : "Upload history"}>
          {imports.length === 0 ? <p className="text-ink-2">No uploads yet.</p> : (
            <ul className="grid gap-2 text-sm">
              {imports.map((i) => (
                <li key={i.id} className="flex justify-between gap-4">
                  <span className="truncate">{i.filename ?? i.source} <span className="text-ink-3">({i.channels.join(", ")}, {i.months.map((m) => monthLabel(m, "short")).join(", ")})</span></span>
                  <span className="shrink-0 text-ink-3">{new Date(i.importedAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {isSuper && (
        <Section title="Delete client" lead="Removes their logins and every month of data. This can’t be undone.">
          <DeleteClientButton clientId={id} name={client.name} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {lead && <p className="mb-5 mt-0.5 text-sm text-ink-2">{lead}</p>}
      {!lead && <div className="mb-5" />}
      {children}
    </section>
  );
}
