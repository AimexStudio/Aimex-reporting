import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listClientLogins, listClients } from "@/lib/data";
import { BulkAddLoginForm } from "./BulkAddLoginForm";

export const metadata = { title: "Logins" };
export const dynamic = "force-dynamic";

export default async function LoginsPage() {
  await requireAdmin(); // super admins only
  const [clients, logins] = await Promise.all([listClients(), listClientLogins()]);
  const name = new Map(clients.map((c) => [c.id, c.name]));
  return (
    <div className="grid gap-10 [&>*]:min-w-0">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Logins</h1>
        <p className="mt-1 max-w-3xl text-ink-2">
          Give one person access to several clients at once, and see who can see what. Each client has its own permission:
          viewers see that client’s reports; admins can also upload its data and edit its report.
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">Add a login to several clients</h2>
        <p className="mb-5 mt-0.5 text-sm text-ink-2">A new email gets a login with these clients. An existing login keeps its password and just gains the ticked clients.</p>
        <BulkAddLoginForm clients={clients.map((c) => ({ id: c.id, name: c.name, category: c.category }))} />
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">All client logins <span className="ml-1 text-base font-normal text-ink-3">{logins.length}</span></h2>
        <p className="mb-4 mt-0.5 text-sm text-ink-2">Change a permission, reset a password or remove access on the client’s own page.</p>
        {logins.length === 0 ? <p className="text-ink-2">No client logins yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-2">
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 pr-4 font-medium">Clients</th>
                  <th className="py-2 font-medium">Last signed in</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((u) => (
                  <tr key={u.id} className="border-b border-line-soft align-top last:border-0">
                    <td className="break-all py-3 pr-4 font-medium">{u.email}</td>
                    <td className="py-3 pr-4">
                      <ul className="flex flex-wrap gap-1.5">
                        {Object.entries(u.memberships).sort((a, b) => (name.get(a[0]) ?? "").localeCompare(name.get(b[0]) ?? "")).map(([id, role]) => (
                          <li key={id}>
                            <Link href={`/admin/clients/${id}`} className="inline-flex items-center gap-1.5 rounded-full bg-line-soft px-2.5 py-0.5 hover:bg-line">
                              {name.get(id) ?? "Removed client"}
                              {role === "client_admin" && <span className="rounded-full bg-night px-1.5 text-[11px] font-semibold text-white">Admin</span>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="whitespace-nowrap py-3 text-ink-2">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
