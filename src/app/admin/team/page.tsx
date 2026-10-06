import { requireAdmin } from "@/lib/auth";
import { listAdmins } from "@/lib/data";
import { AddAdminForm, ChangeMyPasswordForm, RemoveAdminButton } from "./TeamForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

const date = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "Never";

export default async function TeamPage() {
  const me = await requireAdmin();
  const admins = await listAdmins();
  return (
    <div className="grid grid-cols-1 gap-8 [&>*]:min-w-0">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Team: super admins</h1>
        <p className="mt-1 max-w-2xl text-ink-2">
          Super admins can see every client, upload data, manage every client’s logins, and add or remove other super admins.
          To give someone access to just one client, add them under that client’s Logins as an Admin instead.
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">Super admins</h2>
        <p className="mb-5 mt-0.5 text-sm text-ink-2">
          {admins.length === 1 ? "You’re the only admin." : `${admins.length} people have admin access.`}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-2">
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="hidden py-2 pr-4 font-medium sm:table-cell">Added</th>
                <th className="py-2 pr-4 font-medium">Last signed in</th>
                <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b border-line-soft last:border-0">
                  <td className="break-all py-3 pr-4 font-medium">
                    {a.email}
                    {a.id === me.id && <span className="ml-2 rounded-full bg-night px-2 py-0.5 text-[11px] font-semibold text-white">You</span>}
                  </td>
                  <td className="hidden py-3 pr-4 text-ink-2 sm:table-cell">{date(a.createdAt)}</td>
                  <td className="py-3 pr-4 text-ink-2">{date(a.lastLoginAt)}</td>
                  <td className="py-3 text-right">
                    {a.id !== me.id && admins.length > 1 && <RemoveAdminButton userId={a.id} email={a.email} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">Add a super admin</h2>
        <p className="mb-5 mt-0.5 text-sm text-ink-2">They’ll sign in on the same page as clients and land in this admin area.</p>
        <AddAdminForm />
      </section>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">Change my password</h2>
        <p className="mb-5 mt-0.5 text-sm text-ink-2">You’ll stay signed in here and be signed out on any other devices.</p>
        <ChangeMyPasswordForm />
      </section>
    </div>
  );
}
