"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { checkPassword, hashPassword, requireAdmin, startSession } from "@/lib/auth";
import { EmailTakenError, createAdmin, getUser, removeAdmin, setPassword } from "@/lib/data";

// Every action checks for an admin session itself: server actions are public endpoints.

export type TeamState = { error?: string; ok?: string; email?: string; password?: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function addAdmin(_p: TeamState, f: FormData): Promise<TeamState> {
  await requireAdmin();
  const email = str(f, "email").toLowerCase();
  let password = str(f, "password");
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  if (password && password.length < 10) return { error: "Passwords need at least 10 characters, or leave it blank to generate one." };
  if (!password) password = crypto.randomBytes(9).toString("base64url");
  try {
    await createAdmin(email, await hashPassword(password));
  } catch (e) {
    if (e instanceof EmailTakenError) return { error: `${email} already has an account (as an admin or a client).` };
    throw e;
  }
  revalidatePath("/admin/team");
  return { ok: `${email} can now sign in as an admin.`, email, password };
}

export async function removeAdminAction(f: FormData): Promise<void> {
  const me = await requireAdmin();
  const id = str(f, "userId");
  if (id === me.id) return; // the page never offers this; refuse anyway
  try {
    await removeAdmin(id);
  } catch {
    // The page re-renders with the current list either way.
  }
  revalidatePath("/admin/team");
}

export async function changeMyPassword(_p: TeamState, f: FormData): Promise<TeamState> {
  const me = await requireAdmin();
  const current = String(f.get("current") ?? "");
  const next = String(f.get("next") ?? "");
  const confirm = String(f.get("confirm") ?? "");
  if (!(await checkPassword(current, me.passwordHash))) return { error: "Your current password isn’t right." };
  if (next.length < 10) return { error: "Your new password needs at least 10 characters." };
  if (next !== confirm) return { error: "The two new passwords don’t match." };
  await setPassword(me.id, await hashPassword(next)); // signs out every other device
  const updated = await getUser(me.id);
  if (updated) await startSession(updated); // keep this device signed in
  return { ok: "Password changed. You’ve been signed out on any other devices." };
}
