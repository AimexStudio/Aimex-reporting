import { NextResponse } from "next/server";
import { getTaskComments } from "@/lib/clickup";
import { errorResponse, staffOnly } from "../../_staff";

export const dynamic = "force-dynamic";

/** GET: a task's comments, newest first, as { text, who, date }. Cached 10 minutes per task. */
export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const denied = await staffOnly();
  if (denied) return denied;
  const { taskId } = await params;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(taskId)) return NextResponse.json({ error: "Unknown task." }, { status: 400 });
  try {
    return NextResponse.json({ comments: await getTaskComments(taskId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
