import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ClickUpError } from "@/lib/clickup";

/** Same rule as the Team page: Aimex super admins only. Client logins (viewers or admins) get 403. */
export async function staffOnly(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to see the Admin Report." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  return null;
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ClickUpError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[task-report]", e instanceof Error ? e.message : "unknown error"); // never logs the token
  return NextResponse.json({ error: "Couldn’t load the Admin Report." }, { status: 500 });
}
