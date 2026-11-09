import { NextResponse } from "next/server";
import { ACTIVE_CLIENT_COOKIE, getCurrentUser } from "@/lib/auth";
import { membershipsOf } from "@/lib/memberships";

/**
 * Switches the client a multi-client login is viewing. Only clients the login belongs to are accepted.
 * Redirects use a plain path ("/dashboard"): behind Cloud Run's proxy the request's own URL is the
 * server's internal address (localhost), so an absolute redirect built from it would send the browser nowhere.
 */
function goTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const user = await getCurrentUser();
  if (!user) return goTo("/login");
  const res = goTo("/dashboard");
  if (membershipsOf(user)[clientId]) {
    res.cookies.set(ACTIVE_CLIENT_COOKIE, clientId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
  }
  return res;
}
