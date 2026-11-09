import { NextResponse } from "next/server";
import { getTaskSummary } from "@/lib/clickup";
import { errorResponse, staffOnly } from "../_staff";

export const dynamic = "force-dynamic";

/** GET: the token owner, workspace name and their tasks. Cached 5 minutes; ?refresh=1 skips the cache. */
export async function GET(req: Request) {
  const denied = await staffOnly();
  if (denied) return denied;
  try {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    return NextResponse.json(await getTaskSummary({ refresh }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
