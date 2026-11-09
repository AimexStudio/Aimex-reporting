import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { membershipsOf } from "@/lib/memberships";
import { getClient, getDashboard, getDashboards, getPeriod, getStoredFile } from "@/lib/data";
import { periodCsv, roomsCsv, safeName, salesCsv } from "@/lib/exports";
import { isPeriod } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * Downloads for one client, for anyone who may manage its data (Aimex staff, or that client's admins):
 *   ?dash=<id>&file=<key>     an uploaded file as it was uploaded (key: import id, "sales:<period>" or "rooms:<date>")
 *   ?dash=<id>&period=<id>    a month's or week's stored figures as CSV
 *   ?dash=<id>&sales=<id>     a sales snapshot as CSV
 *   ?dash=<id>&rooms=<date>   a room sales report as CSV
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role !== "admin" && membershipsOf(user)[clientId] !== "client_admin") return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const q = new URL(req.url).searchParams;
  const client = await getClient(clientId);
  const dashId = q.get("dash") || (await getDashboards(clientId))[0]?.id;
  const dash = client && dashId ? await getDashboard(clientId, dashId) : null;
  if (!client || !dash) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // "Client" for the main dashboard; "Client Company" for a group's other dashboards.
  const sameName = !dash.name || dash.name === "Main" || dash.name.trim().toLowerCase() === client.name.trim().toLowerCase();
  const who = safeName(sameName ? client.name : `${client.name} ${dash.name}`);
  const send = (body: string | Uint8Array, type: string, filename: string) =>
    new NextResponse(body as BodyInit, { headers: {
      "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${safeName(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    } });

  const file = q.get("file");
  if (file) {
    if (!/^([\w-]{1,60}|sales:\d{4}-(\d{2}|W\d{2})|rooms:\d{4}-\d{2}-\d{2})$/.test(file)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const f = await getStoredFile(clientId, dash.id, file);
    if (!f) return NextResponse.json({ error: "That file wasn’t kept. Uploads from before files were kept can only be downloaded as figures." }, { status: 404 });
    return send(f.encoding === "base64" ? Buffer.from(f.data, "base64") : "\uFEFF" + f.data, f.contentType, f.filename);
  }
  const period = q.get("period");
  if (period && isPeriod(period)) {
    const m = await getPeriod(clientId, dash.id, period);
    if (!m) return NextResponse.json({ error: "No figures for that period." }, { status: 404 });
    return send("\uFEFF" + periodCsv(period, m), "text/csv; charset=utf-8", `${who}-${period}.csv`);
  }
  const sales = q.get("sales");
  if (sales && isPeriod(sales) && dash.sales?.[sales]) return send("\uFEFF" + salesCsv(dash.sales[sales]), "text/csv; charset=utf-8", `${who}-sales-${sales}.csv`);
  const rooms = q.get("rooms");
  if (rooms && /^\d{4}-\d{2}-\d{2}$/.test(rooms) && dash.roomSales?.[rooms]) return send("\uFEFF" + roomsCsv(dash.roomSales[rooms]), "text/csv; charset=utf-8", `${who}-room-sales-${rooms}.csv`);
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
