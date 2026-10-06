import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
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

/** Aimex super admin only: all clients, logins, the Team page. */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "client_admin" && user.clientId) redirect(`/admin/clients/${user.clientId}`);
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

/** Anyone who may use the admin area at all: super admins and client admins. */
export async function requireStaff(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin" || (user.role === "client_admin" && user.clientId)) return user;
  redirect("/dashboard");
}

/**
 * May this person manage this client's data (uploads, notes, report settings)?
 * Super admins: any client. Client admins: only the client they belong to.
 */
export async function requireClientAccess(clientId: string): Promise<User> {
  const user = await requireStaff();
  if (user.role === "admin") return user;
  if (user.clientId !== clientId) redirect(`/admin/clients/${user.clientId}`);
  return user;
}

export const isSuperAdmin = (u: User | null) => u?.role === "admin";

/** Returns the signed-in viewer or client admin and the ONLY clientId they may ever see. */
export async function requireClient(): Promise<{ user: User; clientId: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  if (!user.clientId) redirect("/login");
  return { user, clientId: user.clientId };
}
