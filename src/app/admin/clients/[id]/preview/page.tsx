import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";
import { Dashboard } from "@/components/Dashboard";
import { ReportShell } from "@/components/ReportShell";

export const dynamic = "force-dynamic";

/** Admin-only: exactly what the client sees, wrapped in a banner. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const data = await getDashboardData(id);
  if (!data) notFound();
  return (
    <div className="-mx-5 -my-8 sm:-mx-8 sm:-my-10">
      <ReportShell clientName={data.client.name}
        banner={
          <div className="bg-brand px-5 py-2 text-center text-sm font-medium text-night">
            You’re seeing {data.client.name}’s dashboard as they see it.{" "}
            <Link href={`/admin/clients/${id}`} className="font-medium underline">Back to admin</Link>
          </div>
        }>
        <Dashboard data={data} />
      </ReportShell>
    </div>
  );
}
