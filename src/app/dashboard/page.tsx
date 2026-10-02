import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";
import { Dashboard } from "@/components/Dashboard";
import { ReportShell } from "@/components/ReportShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your report" };

export default async function ClientDashboardPage() {
  // clientId comes ONLY from the signed-in account, so a client can never load another client's data.
  const { clientId } = await requireClient();
  const data = await getDashboardData(clientId);
  if (!data) notFound();
  return (
    <ReportShell clientName={data.client.name}>
      <Dashboard data={data} />
    </ReportShell>
  );
}
