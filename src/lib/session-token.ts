/** JWT sign/verify only — no DB access, so the proxy can use it too. */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "aimex_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  uid: string;
  role: "admin" | "client_admin" | "client";
  v: number; // sessionVersion at sign-in
}

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-me")) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters (see .env.example).");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ role: p.role, v: p.v })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.uid)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (!payload.sub || !["admin", "client_admin", "client"].includes(String(payload.role))) return null;
    return { uid: payload.sub, role: payload.role as SessionPayload["role"], v: Number(payload.v) };
  } catch {
    return null;
  }
}
