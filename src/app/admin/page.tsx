import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { monthLabel } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

function lastMonth() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function AdminHome() {
  await requireAdmin();
  const clients = await listClients();
  const due = lastMonth();
  const behind = clients.filter((c) => !c.latestMonth || c.latestMonth < due);

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-ink-2">
            {clients.length === 0
              ? "No clients yet."
              : behind.length === 0
                ? clients.length === 1 ? `${monthLabel(due)} is uploaded.` : `All ${clients.length} clients have ${monthLabel(due)} uploaded.`
                : `${behind.length} of ${clients.length} still need ${monthLabel(due)} uploaded.`}
          </p>
        </div>
        <Link href="/admin/clients/new" className="btn">Add client</Link>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-lg font-medium">Add your first client to get started</p>
          <p className="mx-auto mt-1 max-w-md text-ink-2">You’ll create their login, then upload a CSV of their monthly numbers.</p>
          <Link href="/admin/clients/new" className="btn mt-5">Add client</Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-2">
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Login</th>
                <th className="px-5 py-3 font-medium">Latest month</th>
                <th className="px-5 py-3 text-right font-medium">Months on file</th>
                <th className="px-5 py-3 font-medium">Last signed in</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const isBehind = !c.latestMonth || c.latestMonth < due;
                return (
                  <tr key={c.id} className="border-b border-line-soft last:border-0 hover:bg-page/60">
                    <td className="px-5 py-3.5">
                      <Link href={`/admin/clients/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
                      {c.contactName && <div className="text-ink-3">{c.contactName}</div>}
                    </td>
                    <td className="px-5 py-3.5 text-ink-2">{c.email ?? "–"}</td>
                    <td className="px-5 py-3.5">
                      {c.latestMonth ? monthLabel(c.latestMonth) : "No data yet"}
                      {isBehind && <span className="ml-2 rounded-full bg-neg-soft px-2 py-0.5 text-xs font-medium text-neg">Needs {monthLabel(due, "short")}</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right">{c.monthCount}</td>
                    <td className="px-5 py-3.5 text-ink-2">
                      {c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "Never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
