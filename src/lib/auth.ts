import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { membershipsOf } from "./memberships";
import type { User } from "@/db";
import { getUser } from "./data";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session-token";

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function startSession(user: User) {
  const token = await signSession({ uid: user.id, role: user.role, v: user.sessionVersion });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The signed-in user, re-checked against the database on every request:
 * deleted accounts and changed passwords stop working immediately.
 */
export async function getCurrentUser(): Promise<User | null> {
  const payload = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const user = await getUser(payload.uid);
  if (!user || user.sessionVersion !== payload.v || user.role !== payload.role) return null;
  return user;
}

/** The client this login most recently chose to view (a cookie), if they may still see it. */
export const ACTIVE_CLIENT_COOKIE = "aimex_client";

async function activeClientOf(user: User): Promise<string | null> {
  const m = membershipsOf(user);
  const ids = Object.keys(m);
  if (!ids.length) return null;
  const chosen = (await cookies()).get(ACTIVE_CLIENT_COOKIE)?.value;
  return chosen && m[chosen] ? chosen : ids[0];
}

/** The first client this login may manage (admin permission), if any. */
function firstAdminClient(user: User): string | null {
  const m = membershipsOf(user);
  return Object.keys(m).find((id) => m[id] === "client_admin") ?? null;
}

/** Aimex super admin only: all clients, logins, the Team page. */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    const own = firstAdminClient(user);
    redirect(own ? `/admin/clients/${own}` : "/dashboard");
  }
  return user;
}

/** Anyone who may use the admin area at all: super admins and logins that are admin for at least one client. */
export async function requireStaff(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin" || firstAdminClient(user)) return user;
  redirect("/dashboard");
}

/**
 * May this person manage this client's data (uploads, notes, report settings)?
 * Super admins: any client. Others: only clients where they have admin permission.
 */
export async function requireClientAccess(clientId: string): Promise<User> {
  const user = await requireStaff();
  if (user.role === "admin") return user;
  if (membershipsOf(user)[clientId] !== "client_admin") redirect(`/admin/clients/${firstAdminClient(user)}`);
  return user;
}

export const isSuperAdmin = (u: User | null) => u?.role === "admin";

/**
 * The signed-in viewer or client admin, the ONE client they're looking at now (always one they belong to),
 * their permission for it, and every client they can switch to.
 */
export async function requireClient(): Promise<{ user: User; clientId: string; canManage: boolean; clientIds: string[] }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  const clientId = await activeClientOf(user);
  if (!clientId) redirect("/login");
  const m = membershipsOf(user);
  return { user, clientId, canManage: m[clientId] === "client_admin", clientIds: Object.keys(m) };
}
