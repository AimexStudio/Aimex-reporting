"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { parseMetricsCsv } from "@/lib/csv";
import {
  EmailTakenError, createClientWithLogin, deleteClientCascade, deleteMonth as removeMonth, getClient,
  getClientLogin, saveImport, saveMonthNote as storeNote, setPassword, updateClientAndEmail,
} from "@/lib/data";
import { isMonth, monthLabel } from "@/lib/metrics";

// Every action calls requireAdmin() itself: server actions are public endpoints,
// so page-level checks alone would not protect them.

export type FormState = { error?: string; ok?: string; password?: string; email?: string; clientId?: string };

const CURRENCIES = ["ZAR", "USD", "GBP", "EUR", "AUD"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const generatePassword = () => crypto.randomBytes(9).toString("base64url"); // 12 chars

export async function createClient(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const name = str(f, "name");
  const email = str(f, "email").toLowerCase();
  const currency = CURRENCIES.includes(str(f, "currency")) ? str(f, "currency") : "ZAR";
  let password = str(f, "password");
  if (!name) return { error: "Enter the client’s name." };
  if (!validEmail(email)) return { error: "Enter a valid login email." };
  if (password && password.length < 10) return { error: "Passwords need at least 10 characters, or leave it blank to generate one." };
  if (!password) password = generatePassword();

  const passwordHash = await hashPassword(password);
  let client;
  try {
    client = await createClientWithLogin(
      { name, contactName: str(f, "contactName") || null, currency, adminNotes: str(f, "adminNotes") || null },
      { email, passwordHash },
    );
  } catch (e) {
    if (e instanceof EmailTakenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin");
  return { ok: `${name} is set up.`, email, password, clientId: client.id };
}

export async function updateClient(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const id = str(f, "clientId");
  const name = str(f, "name");
  const email = str(f, "email").toLowerCase();
  if (!name) return { error: "Enter the client’s name." };
  if (!validEmail(email)) return { error: "Enter a valid login email." };
  try {
    await updateClientAndEmail(
      id,
      {
        name,
        contactName: str(f, "contactName") || null,
        currency: CURRENCIES.includes(str(f, "currency")) ? str(f, "currency") : "ZAR",
        adminNotes: str(f, "adminNotes") || null,
      },
      email,
    );
  } catch (e) {
    if (e instanceof EmailTakenError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/clients/${id}`);
  revalidatePath("/admin");
  return { ok: "Changes saved." };
}

export async function resetClientPassword(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const id = str(f, "clientId");
  let password = str(f, "password");
  if (password && password.length < 10) return { error: "Passwords need at least 10 characters, or leave it blank to generate one." };
  if (!password) password = generatePassword();
  const login = await getClientLogin(id);
  if (!login) return { error: "This client has no login account." };
  await setPassword(login.id, await hashPassword(password));
  return { ok: "Password changed. The client has been signed out everywhere.", password, email: login.email };
}

export async function deleteClient(f: FormData) {
  await requireAdmin();
  const id = str(f, "clientId");
  await deleteClientCascade(id); // removes login, data, notes and upload history
  revalidatePath("/admin");
  redirect("/admin");
}

export type ImportResult = { error?: string; errors?: string[]; ok?: string; warnings?: string[] };

export interface ImportFile {
  csv: string;
  filename: string;
  defaultMonth: string;
  defaultChannel: string;
  conversionsAs?: "conversions" | "leads";
}

/**
 * Imports one or more CSV files in one go. Every file is re-parsed and checked on
 * the server first; if any file has a problem, or two files contain the same
 * channel for the same month, nothing is saved.
 */
export async function importCsvFiles(input: { clientId: string; files: ImportFile[]; note: string }): Promise<ImportResult> {
  await requireAdmin();
  const client = await getClient(input.clientId);
  if (!client) return { error: "That client no longer exists." };
  if (!input.files.length) return { error: "Choose at least one CSV file." };
  if (input.files.length > 12) return { error: "Upload up to 12 files at a time." };

  const parsedFiles = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();
  for (const f of input.files) {
    const name = f.filename || "file";
    if (f.csv.length > 4_000_000) {
      errors.push(`${name}: too large. Keep each CSV under 4 MB.`);
      continue;
    }
    const parsed = parseMetricsCsv(
      f.csv,
      isMonth(f.defaultMonth) ? f.defaultMonth : undefined,
      f.defaultChannel.trim().slice(0, 60) || undefined,
      { conversionsAs: f.conversionsAs === "leads" ? "leads" : "conversions" },
    );
    for (const e of parsed.errors) errors.push(`${name}: ${e}`);
    for (const pair of new Set(parsed.rows.map((r) => `${r.month}|${r.channel}`))) {
      const other = seen.get(pair);
      const [m, c] = pair.split("|");
      if (other) errors.push(`${other} and ${name} both contain ${c} for ${monthLabel(m)}. Give one of them a different channel, or upload them separately.`);
      else seen.set(pair, name);
    }
    parsedFiles.push({ f, parsed });
  }
  if (errors.length) return { error: "Nothing was imported.", errors: errors.slice(0, 12) };

  const allMonths = new Set(parsedFiles.flatMap((p) => p.parsed.months));
  const note = input.note.trim().slice(0, 4000) || undefined;
  for (const { f, parsed } of parsedFiles) {
    await saveImport({
      clientId: client.id,
      rows: parsed.rows,
      months: parsed.months,
      filename: f.filename || null,
      note: allMonths.size === 1 ? note : undefined,
      breakdowns: parsed.breakdowns,
    });
  }

  revalidatePath(`/admin/clients/${client.id}`);
  revalidatePath("/dashboard");
  const channels = [...new Set(parsedFiles.flatMap((p) => p.parsed.channels))].join(", ");
  const months = [...allMonths].sort();
  return {
    ok: `Imported ${channels} for ${months.length === 1 ? monthLabel(months[0]) : `${months.length} months`}${parsedFiles.length > 1 ? ` from ${parsedFiles.length} files` : ""}. ${client.name}’s dashboard is updated.`,
    warnings: [...new Set(parsedFiles.flatMap((p) => p.parsed.warnings.map((w) => (parsedFiles.length > 1 ? `${p.f.filename}: ${w}` : w))))],
  };
}

export async function saveMonthNote(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const clientId = str(f, "clientId");
  const month = str(f, "month");
  const body = str(f, "body");
  if (!isMonth(month)) return { error: "Unknown month." };
  if (!(await storeNote(clientId, month, body.slice(0, 4000) || null))) return { error: "That month has no data yet." };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: body ? "Note saved." : "Note removed." };
}

export async function deleteMonth(f: FormData) {
  await requireAdmin();
  const clientId = str(f, "clientId");
  const month = str(f, "month");
  if (!isMonth(month)) return;
  await removeMonth(clientId, month); // figures and note for that month
  revalidatePath(`/admin/clients/${clientId}`);
}
