/** Which clients a login may see, and with which permission. Pure: safe on server and client. */
import type { User } from "@/db/types";

export type ClientRole = "client" | "client_admin";

/** A login's clients. Logins from before memberships existed belong to their one clientId. */
export function membershipsOf(u: Pick<User, "role" | "clientId" | "memberships">): Record<string, ClientRole> {
  if (u.role === "admin") return {};
  if (u.memberships && Object.keys(u.memberships).length) return u.memberships;
  return u.clientId ? { [u.clientId]: u.role === "client_admin" ? "client_admin" : "client" } : {};
}

/** The fields to save for a set of memberships: the overall role is admin if any client grants it. */
export function membershipFields(m: Record<string, ClientRole>) {
  const ids = Object.keys(m);
  return {
    memberships: m,
    clientIds: ids,
    clientId: ids[0] ?? null,
    role: (Object.values(m).includes("client_admin") ? "client_admin" : "client") as ClientRole,
  };
}
