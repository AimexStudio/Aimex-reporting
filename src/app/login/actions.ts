"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, startSession } from "@/lib/auth";
import { clearFailures, findUserByEmail, isThrottled, recordFailure, touchLogin } from "@/lib/data";

// A valid bcrypt hash to compare against when the email doesn't exist, so timing doesn't reveal accounts.
const DUMMY_HASH = "$2b$12$QruhXjTvH/hQ5r0Frk8gSOgqk8ZeN2XT19mH4UCOMK6IzfqHaukWC";

export type LoginState = { error?: string; email?: string };

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  // Brake on password guessing: 8 failures per email + network per 15 minutes (stored in Firestore,
  // so it holds across serverless instances).
  const key = `${email}|${ip}`;
  if (await isThrottled(key)) {
    return { error: "Too many attempts. Wait 15 minutes, then try again.", email };
  }

  const user = await findUserByEmail(email);
  const ok = await checkPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await recordFailure(key);
    return { error: "That email and password don’t match an account.", email };
  }

  await clearFailures(key);
  await touchLogin(user.id);
  await startSession(user);
  redirect(user.role === "admin" ? "/admin" : "/dashboard");
}
