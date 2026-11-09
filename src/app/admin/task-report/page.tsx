import { requireAdmin } from "@/lib/auth";
import { TaskReport } from "./TaskReport";

export const metadata = { title: "Admin Report" };
export const dynamic = "force-dynamic";

/** Admin Report (ClickUp tasks) for internal Aimex staff (same rule as the Team page: super admins only). */
export default async function TaskReportPage() {
  await requireAdmin();
  return <TaskReport />;
}
