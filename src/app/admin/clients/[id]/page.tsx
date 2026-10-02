import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getClient, getClientLogin, getDashboardData, listImports } from "@/lib/data";
import { monthLabel, formatMetric } from "@/lib/metrics";
import { UploadPanel } from "../../_components/UploadPanel";
import {
  EditClientForm, ResetPasswordForm, DeleteClientButton, MonthNoteForm, DeleteMonthButton,
} from "../../_components/ClientForms";

export const dynamic = "force-dynamic";

export default async function ClientAdminPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();
  const [login, data, imports] = await Promise.all([getClientLogin(id), getDashboardData(id), listImports(id)]);
  if (!data) notFound();
  const months = [...data.months].reverse();

  return (
    <div className="grid grid-cols-1 gap-10">
      <div>
        <Link href="/admin" className="text-sm text-ink-2 hover:underline">‹ Clients</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1>
            <p className="mt-1 text-ink-2">
              {login?.email ?? "No login"} · {data.months.length} month{data.months.length === 1 ? "" : "s"} on file
            </p>
          </div>
          <Link href={`/admin/clients/${id}/preview`} className="btn btn-quiet">See their dashboard</Link>
        </div>
      </div>

      <Section title="Upload monthly data" lead="Add a month of results from a CSV. You’ll see a preview before anything is saved.">
        <UploadPanel clientId={id} clientName={client.name} existing={data.months.flatMap((m) => m.channels.map((c) => `${m.month}|${c.channel}`))} />
      </Section>

      <Section title="Months on file" lead="Notes appear at the top of the client’s dashboard for that month.">
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
                  <div className="mt-1"><DeleteMonthButton clientId={id} month={m.month} label={monthLabel(m.month)} /></div>
                </div>
                <MonthNoteForm clientId={id} month={m.month} body={m.note} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Section title="Client details">
          <EditClientForm c={{ ...client, email: login?.email }} />
        </Section>
        <div className="grid min-w-0 grid-cols-1 content-start gap-10">
          <Section title="Password" lead="Changing it signs the client out on every device.">
            <ResetPasswordForm clientId={id} />
          </Section>
          <Section title="Upload history">
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
      </div>

      <Section title="Delete client" lead="Removes their login and every month of data. This can’t be undone.">
        <DeleteClientButton clientId={id} name={client.name} />
      </Section>
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
