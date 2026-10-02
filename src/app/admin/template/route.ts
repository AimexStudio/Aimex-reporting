import { getCurrentUser } from "@/lib/auth";
import { CSV_TEMPLATE } from "@/lib/csv";

export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") return new Response("Not found", { status: 404 });
  return new Response(CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="aimex-monthly-template.csv"',
    },
  });
}
