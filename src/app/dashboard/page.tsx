import { requireClient } from "@/lib/auth";
import { ReportPage } from "@/components/ReportPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your report" };

export default async function ClientDashboardPage() {
  // clientId comes ONLY from the signed-in account, so a client can never load another client's data.
  const { clientId } = await requireClient();
  return <ReportPage clientId={clientId} href={(v) => (v === "overview" ? "/dashboard" : `/dashboard/${v}`)} />;
}
