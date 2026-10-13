import { getCurrentUser } from "@/lib/auth";
import { CSV_TEMPLATE } from "@/lib/csv";
import { SALES_TEMPLATE } from "@/lib/sales-import";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (user?.role !== "admin" && user?.role !== "client_admin") return new Response("Not found", { status: 404 });
  const sales = new URL(req.url).searchParams.get("kind") === "sales";
  return new Response(sales ? SALES_TEMPLATE : CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${sales ? "aimex-sales-template.csv" : "aimex-monthly-template.csv"}"`,
    },
  });
}
