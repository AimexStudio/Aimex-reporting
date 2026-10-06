import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { Wordmark } from "@/components/Wordmark";
import { signOut } from "@/app/actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireStaff();
  const isSuper = admin.role === "admin";
  return (
    <div className="min-h-dvh">
      <header className="bg-night text-white print:hidden">
        {/* On phones the links wrap onto their own row under the logo and sign-out button. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5 sm:flex-nowrap sm:px-8">
          <Link href={isSuper ? "/admin" : "/dashboard"} className="shrink-0"><Wordmark /></Link>
          <nav className="order-last flex w-full gap-5 text-sm text-white/75 sm:order-none sm:mr-auto sm:w-auto">
            {isSuper ? (
              <>
                <Link href="/admin" className="hover:text-white">Clients</Link>
                <Link href="/admin/clients/new" className="hover:text-white">Add client</Link>
                <Link href="/admin/team" className="hover:text-white">Team</Link>
              </>
            ) : (
              <>
                <Link href="/dashboard" className="hover:text-white">Report</Link>
                <Link href={`/admin/clients/${admin.clientId}`} className="hover:text-white">Manage data</Link>
              </>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-white/60 md:inline">{admin.email}</span>
            <form action={signOut}>
              <button className="rounded-md px-2.5 py-1 text-white/85 ring-1 ring-white/25 hover:bg-white/10">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">{children}</main>
    </div>
  );
}
