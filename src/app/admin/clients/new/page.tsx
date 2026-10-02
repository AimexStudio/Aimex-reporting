import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { NewClientForm } from "../../_components/ClientForms";

export const metadata = { title: "Add client" };

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <div className="max-w-2xl">
      <Link href="/admin" className="text-sm text-ink-2 hover:underline">‹ Clients</Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Add client</h1>
      <p className="mb-8 mt-1 text-ink-2">This creates the client and the login they’ll use to see their dashboard.</p>
      <div className="rounded-2xl border border-line bg-surface p-6"><NewClientForm /></div>
    </div>
  );
}
