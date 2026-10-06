import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getDashboard } from "@/lib/data";
import { ReportPage } from "@/components/ReportPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your report" };

export default async function ClientSubDashboardPage({ params }: { params: Promise<{ view: string }> }) {
  // The dashboard is looked up inside the signed-in client's own account only.
  const { clientId } = await requireClient();
  const { view } = await params;
  if (!(await getDashboard(clientId, view))) notFound();
  return <ReportPage clientId={clientId} view={view} href={(v) => (v === "overview" ? "/dashboard" : `/dashboard/${v}`)} />;
}
