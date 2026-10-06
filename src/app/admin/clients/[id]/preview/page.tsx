import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClientAccess } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { ReportPage } from "@/components/ReportPage";

export const dynamic = "force-dynamic";

/** Admin-only: exactly what the client sees, wrapped in a banner. */
export default async function PreviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { id } = await params;
  await requireClientAccess(id);
  const { d } = await searchParams;
  const client = await getClient(id);
  if (!client) notFound();
  return (
    // Breaks out of the admin page's width so the preview is full width, like the client's view.
    <div className="-my-8 mx-[calc(50%-50vw)] sm:-my-10 [&_.report-root]:lg:grid-cols-[272px_minmax(0,1fr)]">
      <ReportPage clientId={id} view={d} href={(v) => `/admin/clients/${id}/preview?d=${v}`} showSignOut={false}
        banner={
          <div className="bg-brand px-5 py-2 text-center text-sm font-medium text-night">
            You’re seeing {client.name}’s report as they see it.{" "}
            <Link href={`/admin/clients/${id}${d && d !== "overview" ? `?d=${d}` : ""}`} className="underline">Back to admin</Link>
          </div>
        } />
    </div>
  );
}
