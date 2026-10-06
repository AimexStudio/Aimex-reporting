import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

/**
 * First line of defence only: bounces signed-out visitors to /login.
 * Every page and server action ALSO checks the session against the database
 * (lib/auth.ts), so access control never depends on this file alone.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  // Super admins use /admin; client admins use both (their report, and managing their own client's data);
  // viewers only see /dashboard. Which client a client admin may manage is checked on every page and action.
  if (pathname.startsWith("/admin") && session.role === "client") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  if (pathname.startsWith("/dashboard") && session.role === "admin") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/dashboard/:path*"] };
