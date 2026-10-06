import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { ReportPage } from "@/components/ReportPage";

export const dynamic = "force-dynamic";

/** Admin-only: exactly what the client sees, wrapped in a banner. */
export default async function PreviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { d } = await searchParams;
  const client = await getClient(id);
  if (!client) notFound();
  return (
    <div className="-mx-5 -my-8 sm:-mx-8 sm:-my-10">
      <ReportPage clientId={id} view={d} href={(v) => `/admin/clients/${id}/preview?d=${v}`}
        banner={
          <div className="bg-brand px-5 py-2 text-center text-sm font-medium text-night">
            You’re seeing {client.name}’s report as they see it.{" "}
            <Link href={`/admin/clients/${id}${d && d !== "overview" ? `?d=${d}` : ""}`} className="underline">Back to admin</Link>
          </div>
        } />
    </div>
  );
}
