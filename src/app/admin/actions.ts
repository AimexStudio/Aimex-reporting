"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, requireAdmin, requireClientAccess, requireStaff } from "@/lib/auth";
import { pdfToText } from "@/lib/pdf-text";
import { parseMetricsCsv } from "@/lib/csv";
import { parseSalesCsv } from "@/lib/sales-import";
import { parseRoomSales } from "@/lib/room-sales";
import { cleanChannels } from "@/lib/marketing-channels";
import { membershipsOf } from "@/lib/memberships";
import type { ClientCategory } from "@/lib/category";
import {
  EmailTakenError, LoginError, addUserToClients, saveStoredFile, deleteStoredFile, markImportHasFile, addClientUser, createClientWithLogin, createDashboard, deleteClientCascade, deleteDashboard,
  deleteMonth as removeMonth, getClient, getDashboard, getUser, removeClientUser, renameDashboard, saveDashboardSettings,
  saveGoalActuals, saveImport, saveMonthNote as storeNote, saveSalesSnapshot, saveSectionNotes, setClientLogo, setClientUserRole, setPassword,
  updateClientFields, saveRoomSales, removeChannelFromPeriod, setSnapshotComment,
} from "@/lib/data";
import type { Goal, Milestone } from "@/db/types";
import { isPeriod as isMonth, monthLabel } from "@/lib/metrics";

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
  let made;
  try {
    made = await createClientWithLogin(
      { name, contactName: str(f, "contactName") || null, currency, adminNotes: str(f, "adminNotes") || null, category: asCategory(str(f, "category")) },
      { email, passwordHash },
    );
  } catch (e) {
    if (e instanceof EmailTakenError || e instanceof LoginError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin");
  // An existing login just gains this client: it keeps its own password, so no new details are shown.
  if (made.existingLogin) return { ok: `${name} is set up. ${email} already had a login and can now also see ${name}, with the same password.`, clientId: made.client.id };
  return { ok: `${name} is set up.`, email, password, clientId: made.client.id };
}

export async function updateClient(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const id = str(f, "clientId");
  const name = str(f, "name");
  if (!name) return { error: "Enter the client’s name." };
  await updateClientFields(id, {
    name,
    contactName: str(f, "contactName") || null,
    currency: CURRENCIES.includes(str(f, "currency")) ? str(f, "currency") : "ZAR",
    adminNotes: str(f, "adminNotes") || null,
    category: asCategory(str(f, "category")),
  });
  revalidatePath(`/admin/clients/${id}`);
  revalidatePath("/admin");
  return { ok: "Changes saved." };
}

export async function resetClientPassword(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const clientId = str(f, "clientId");
  const userId = str(f, "userId");
  let password = str(f, "password");
  if (password && password.length < 10) return { error: "Passwords need at least 10 characters, or leave it blank to generate one." };
  if (!password) password = generatePassword();
  const login = await getUser(userId);
  if (!login || !membershipsOf(login)[clientId]) return { error: "That login doesn’t belong to this client." };
  await setPassword(login.id, await hashPassword(password));
  return { ok: "Password changed. They’ve been signed out everywhere.", password, email: login.email };
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
  /** For PDF reports: the original file (base64), kept so it can be downloaded later. CSVs are kept as text. */
  pdfBase64?: string;
  defaultMonth: string;
  defaultChannel: string;
  conversionsAs?: "conversions" | "leads";
}

/**
 * Imports one or more CSV files in one go. Every file is re-parsed and checked on
 * the server first; if any file has a problem, or two files contain the same
 * channel for the same month, nothing is saved.
 */
export async function importCsvFiles(input: { clientId: string; dashboardId: string; files: ImportFile[]; note: string; period?: "month" | "week" }): Promise<ImportResult> {
  await requireClientAccess(String(input.clientId));
  const client = await getClient(input.clientId);
  if (!client) return { error: "That client no longer exists." };
  const dash = await getDashboard(client.id, input.dashboardId);
  if (!dash) return { error: "That dashboard no longer exists." };
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
      { conversionsAs: f.conversionsAs === "leads" ? "leads" : "conversions", period: input.period === "week" ? "week" : "month" },
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
    const importId = await saveImport({
      clientId: client.id,
      dashboardId: dash.id,
      rows: parsed.rows,
      months: parsed.months,
      filename: f.filename || null,
      note: allMonths.size === 1 ? note : undefined,
      breakdowns: parsed.breakdowns,
      partialMonths: parsed.partialMonths,
    });
    // Keep the uploaded file itself, so it can be downloaded from the upload history.
    try {
      const isPdf = !!f.pdfBase64 && f.pdfBase64.length <= 14_000_000;
      await saveStoredFile(client.id, dash.id, importId, isPdf
        ? { filename: f.filename || "report.pdf", contentType: "application/pdf", encoding: "base64", data: f.pdfBase64! }
        : { filename: f.filename || "upload.csv", contentType: "text/csv; charset=utf-8", encoding: "utf8", data: f.csv });
      await markImportHasFile(client.id, dash.id, importId);
    } catch (e) {
      console.error("[upload] couldn’t keep the file", (e as Error).message); // the figures are saved either way
    }
  }

  revalidatePath(`/admin/clients/${client.id}`);
  revalidatePath("/dashboard");
  const channels = [...new Set(parsedFiles.flatMap((p) => p.parsed.channels))].join(", ");
  const months = [...allMonths].sort();
  return {
    ok: `Imported ${channels} for ${months.length === 1 ? monthLabel(months[0]) : `${months.length} months`}${parsedFiles.length > 1 ? ` from ${parsedFiles.length} files` : ""}. ${dash.name === client.name ? `${client.name}’s` : `The ${dash.name}`} dashboard is updated.`,
    warnings: [...new Set(parsedFiles.flatMap((p) => p.parsed.warnings.map((w) => (parsedFiles.length > 1 ? `${p.f.filename}: ${w}` : w))))],
  };
}

export async function saveMonthNote(_p: FormState, f: FormData): Promise<FormState> {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const dashId = str(f, "dashboardId");
  const month = str(f, "month");
  const body = str(f, "body");
  if (!isMonth(month)) return { error: "Unknown month." };
  if (!(await storeNote(clientId, dashId, month, body.slice(0, 4000) || null))) return { error: "That month has no data yet." };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: body ? "Note saved." : "Note removed." };
}

export async function deleteMonth(f: FormData) {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const dashId = str(f, "dashboardId");
  const month = str(f, "month");
  if (!isMonth(month)) return;
  await removeMonth(clientId, dashId, month); // figures and note for that month
  revalidatePath(`/admin/clients/${clientId}`);
}

/* ---------------- dashboards ---------------- */

export async function addDashboard(_p: FormState, f: FormData): Promise<FormState> {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const name = str(f, "name").slice(0, 80);
  if (!name) return { error: "Give the dashboard a name, for example the sub-company or stream." };
  if (!(await getClient(clientId))) return { error: "That client no longer exists." };
  const d = await createDashboard(clientId, name);
  revalidatePath(`/admin/clients/${clientId}`);
  redirect(`/admin/clients/${clientId}?d=${d.id}`);
}

export async function renameDashboardAction(_p: FormState, f: FormData): Promise<FormState> {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const dashId = str(f, "dashboardId");
  const name = str(f, "name").slice(0, 80);
  if (!name) return { error: "Enter a name." };
  try {
    await renameDashboard(clientId, dashId, name);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: "Renamed." };
}

export async function deleteDashboardAction(f: FormData) {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const dashId = str(f, "dashboardId");
  try {
    await deleteDashboard(clientId, dashId);
  } catch {
    // last dashboard or already gone: the page shows the current state
  }
  revalidatePath(`/admin/clients/${clientId}`);
  redirect(`/admin/clients/${clientId}`);
}

/* ---------------- client logins (super admin only) ---------------- */

const asRole = (v: string): "client" | "client_admin" => (v === "client_admin" ? "client_admin" : "client");

export async function addClientUserAction(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const clientId = str(f, "clientId");
  const email = str(f, "email").toLowerCase();
  let password = str(f, "password");
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  if (password && password.length < 10) return { error: "Passwords need at least 10 characters, or leave it blank to generate one." };
  if (!(await getClient(clientId))) return { error: "That client no longer exists." };
  if (!password) password = generatePassword();
  let r;
  try {
    r = await addClientUser(clientId, email, await hashPassword(password), asRole(str(f, "role")));
  } catch (e) {
    if (e instanceof EmailTakenError || e instanceof LoginError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/clients/${clientId}`);
  if (r.existing) return { ok: `${email} already had a login, so they can now also see this client, with their existing password.` };
  return { ok: `${email} can now sign in.`, email, password };
}

export async function changeClientUserRole(f: FormData) {
  await requireAdmin();
  const clientId = str(f, "clientId");
  try { await setClientUserRole(clientId, str(f, "userId"), asRole(str(f, "role"))); } catch { /* page shows current state */ }
  revalidatePath(`/admin/clients/${clientId}`);
}

export async function removeClientUserAction(f: FormData) {
  await requireAdmin();
  const clientId = str(f, "clientId");
  try { await removeClientUser(clientId, str(f, "userId")); } catch { /* page shows current state */ }
  revalidatePath(`/admin/clients/${clientId}`);
}

/* ---------------- report content (super admins and the client's own admins) ---------------- */

const num = (v: string) => {
  const n = Number(v.replace(/[^\d.\-]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};

export async function saveSectionNotesAction(_p: FormState, f: FormData): Promise<FormState> {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const dashId = str(f, "dashboardId");
  const month = str(f, "month");
  const section = str(f, "section").slice(0, 80);
  if (!isMonth(month) || !section) return { error: "Unknown month or section." };
  const insights = str(f, "insights").split(/\r?\n/).map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s*/, "").trim()).filter(Boolean).slice(0, 12).map((l) => l.slice(0, 800));
  const alertTitle = str(f, "alertTitle").slice(0, 160) || null;
  const alertBody = str(f, "alertBody").slice(0, 2000) || null;
  const empty = !insights.length && !alertTitle && !alertBody;
  if (!(await saveSectionNotes(clientId, dashId, month, section, empty ? null : { insights, alertTitle, alertBody }))) {
    return { error: "That month has no data yet." };
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: empty ? "Cleared." : "Saved." };
}

export async function saveGoalActualsAction(_p: FormState, f: FormData): Promise<FormState> {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const actuals: Record<string, number> = {};
  for (const [k, v] of f.entries()) {
    if (k.startsWith("goal:")) { const n = num(String(v)); if (n != null) actuals[k.slice(5)] = n; }
  }
  if (!(await saveGoalActuals(clientId, str(f, "dashboardId"), str(f, "month"), actuals))) return { error: "That month has no data yet." };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: "Saved." };
}

export async function saveReportSettingsAction(_p: FormState, f: FormData): Promise<FormState> {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const dashId = str(f, "dashboardId");
  let goals: Goal[] = [];
  let milestones: Milestone[] = [];
  try {
    goals = (JSON.parse(str(f, "goals") || "[]") as Goal[]).slice(0, 12).filter((g) => g.label && Number.isFinite(g.target)).map((g) => ({
      id: String(g.id || crypto.randomUUID()).slice(0, 60), label: String(g.label).slice(0, 80),
      metric: g.metric ? String(g.metric).slice(0, 40) : null, target: Number(g.target),
      direction: g.direction === "atMost" ? "atMost" : "atLeast",
    }));
    milestones = (JSON.parse(str(f, "milestones") || "[]") as Milestone[]).slice(0, 12).filter((m) => m.title).map((m) => ({
      id: String(m.id || crypto.randomUUID()).slice(0, 60), title: String(m.title).slice(0, 120), when: String(m.when ?? "").slice(0, 80),
      description: String(m.description ?? "").slice(0, 600),
      status: m.status === "done" || m.status === "current" ? m.status : "upcoming",
    }));
  } catch {
    return { error: "Couldn’t read the goals or milestones. Reload the page and try again." };
  }
  const bMin = num(str(f, "benchMin")), bMax = num(str(f, "benchMax"));
  const rate = num(str(f, "roiRate"));
  try {
    await saveDashboardSettings(clientId, dashId, {
      benchmark: bMin != null || bMax != null ? { min: bMin, max: bMax, label: str(f, "benchLabel").slice(0, 80) } : null,
      roi: { saleNoun: str(f, "roiNoun").slice(0, 40) || "sales", avgSaleValue: num(str(f, "roiValue")), rate: rate != null ? Math.min(100, Math.max(0, rate)) : null },
      goals,
      milestones,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: "Report settings saved." };
}

export async function setLogoAction(input: { clientId: string; dataUrl: string | null }): Promise<FormState> {
  await requireClientAccess(String(input.clientId));
  const d = input.dataUrl;
  if (d && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d) || d.length > 300_000)) {
    return { error: "Use a PNG or JPG logo under about 200 KB." };
  }
  await setClientLogo(input.clientId, d);
  revalidatePath(`/admin/clients/${input.clientId}`);
  return { ok: d ? "Logo saved." : "Logo removed." };
}

/* ---------------- sales figures entered by hand ---------------- */

/**
 * Saves sales figures from an uploaded file for one month or week. The file is read again
 * on the server; the browser's preview is never trusted.
 */
export async function saveSalesUpload(input: { clientId: string; dashboardId: string; period: string; csv: string; filename: string; comment?: string }): Promise<FormState> {
  await requireClientAccess(String(input.clientId));
  if (!isMonth(input.period)) return { error: "Choose the month or week these figures are for." };
  if (input.csv.length > 4_000_000) return { error: "That file is too large. Keep sales files under 4 MB." };
  const parsed = parseSalesCsv(input.csv);
  if (parsed.errors.length) return { error: parsed.errors.join(" ") };
  try {
    await saveSalesSnapshot(input.clientId, input.dashboardId, input.period, parsed.rows.slice(0, 20), input.filename.slice(0, 120) || null, input.comment?.trim().slice(0, 3000) || null);
    await saveStoredFile(input.clientId, input.dashboardId, `sales:${input.period}`, { filename: input.filename.slice(0, 120) || "sales.csv", contentType: "text/csv; charset=utf-8", encoding: "utf8", data: input.csv });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/admin/clients/${input.clientId}`);
  return { ok: `Sales figures for ${monthLabel(input.period)} saved.` };
}

export async function deleteSalesAction(f: FormData) {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const month = str(f, "month");
  if (!isMonth(month)) return;
  try {
    await saveSalesSnapshot(clientId, str(f, "dashboardId"), month, null);
    await deleteStoredFile(clientId, str(f, "dashboardId"), `sales:${month}`);
  } catch { /* page shows current state */ }
  revalidatePath(`/admin/clients/${clientId}`);
}

/* ---------------- PDF reports ---------------- */

/** Reads a PDF's text on the server so the upload preview can parse it like any other file. */
export async function extractPdfText(input: { base64: string }): Promise<{ text?: string; error?: string }> {
  await requireStaff();
  if (input.base64.length > 14_000_000) return { error: "That PDF is too large. Keep PDF reports under 10 MB." };
  try {
    const bytes = new Uint8Array(Buffer.from(input.base64, "base64"));
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return { error: "That file isn’t a PDF." };
    return { text: await pdfToText(bytes) };
  } catch {
    return { error: "Couldn’t read that PDF. If it’s a scanned image rather than a downloaded report, it has no text to read." };
  }
}

const asCategory = (v: string): ClientCategory => (v === "collection" ? "collection" : "development");

/* ---------------- Spectrum Collection: room sales uploads ---------------- */

/** Saves a room sales (on the books) report. The file is read again here; the browser's preview is never trusted. */
export async function saveRoomSalesUpload(input: { clientId: string; dashboardId: string; csv: string; filename: string; comment?: string }): Promise<FormState> {
  await requireClientAccess(String(input.clientId));
  if (input.csv.length > 4_000_000) return { error: "That file is too large. Keep room sales files under 4 MB." };
  const parsed = parseRoomSales(input.csv);
  if (!parsed.snapshot) return { error: parsed.errors.join(" ") };
  const snap = { ...parsed.snapshot, days: parsed.snapshot.days.slice(0, 400), filename: input.filename.slice(0, 120) || null, comment: input.comment?.trim().slice(0, 3000) || null };
  try {
    await saveRoomSales(input.clientId, input.dashboardId, snap.reportDate, snap);
    await saveStoredFile(input.clientId, input.dashboardId, `rooms:${snap.reportDate}`, { filename: snap.filename || "room-sales.csv", contentType: "text/csv; charset=utf-8", encoding: "utf8", data: input.csv });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/admin/clients/${input.clientId}`);
  return { ok: `Room sales as at ${snap.reportDate} saved.` };
}

export async function deleteRoomSalesAction(f: FormData) {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const date = str(f, "reportDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  try {
    await saveRoomSales(clientId, str(f, "dashboardId"), date, null);
    await deleteStoredFile(clientId, str(f, "dashboardId"), `rooms:${date}`);
  } catch { /* page shows current state */ }
  revalidatePath(`/admin/clients/${clientId}`);
}

/* ---------------- marketing channels in use (super admins only) ---------------- */

export async function saveMarketingChannelsAction(_p: FormState, f: FormData): Promise<FormState> {
  await requireAdmin(); // super admins only: client admins and viewers are turned away
  const clientId = str(f, "clientId");
  const dashId = str(f, "dashboardId");
  const channels = cleanChannels(f.getAll("channel"));
  try {
    await saveDashboardSettings(clientId, dashId, { marketingChannels: channels });
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: channels.length ? `Saved: ${channels.length} channel${channels.length === 1 ? "" : "s"} shown on the report.` : "Saved: no channels, so the banner is hidden." };
}

/** Removes one channel from one month or week (e.g. an upload saved under the wrong channel). */
export async function removeChannelAction(f: FormData) {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const period = str(f, "month");
  const channel = str(f, "channel").slice(0, 80);
  if (!isMonth(period) || !channel) return;
  await removeChannelFromPeriod(clientId, str(f, "dashboardId"), period, channel);
  revalidatePath(`/admin/clients/${clientId}`);
}

/** Edits the comment on a saved sales or room sales upload. */
export async function saveSnapshotCommentAction(_p: FormState, f: FormData): Promise<FormState> {
  const clientId = str(f, "clientId");
  await requireClientAccess(clientId);
  const field = str(f, "field") === "roomSales" ? "roomSales" : "sales";
  const key = str(f, "key");
  const ok = field === "roomSales" ? /^\d{4}-\d{2}-\d{2}$/.test(key) : isMonth(key);
  if (!ok) return { error: "Unknown period." };
  const comment = str(f, "comment").slice(0, 3000) || null;
  if (!(await setSnapshotComment(clientId, str(f, "dashboardId"), field, key, comment))) return { error: "Those figures no longer exist." };
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: comment ? "Comment saved." : "Comment removed." };
}

/* ---------------- one login, several clients (super admins only) ---------------- */

export type BulkResult = FormState & { added?: string[]; already?: string[]; created?: boolean };

export async function bulkAddLoginAction(_p: BulkResult, f: FormData): Promise<BulkResult> {
  await requireAdmin();
  const email = str(f, "email").toLowerCase();
  let password = str(f, "password");
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  if (password && password.length < 10) return { error: "Passwords need at least 10 characters, or leave it blank to generate one." };
  const ids = [...new Set(f.getAll("client").map(String))].slice(0, 200);
  if (!ids.length) return { error: "Tick at least one client." };
  const entries = [];
  for (const id of ids) {
    if (!(await getClient(id))) continue;
    entries.push({ clientId: id, role: asRole(str(f, `role:${id}`)) });
  }
  if (!entries.length) return { error: "Those clients no longer exist." };
  if (!password) password = generatePassword();
  let r;
  try {
    r = await addUserToClients(email, await hashPassword(password), entries);
  } catch (e) {
    if (e instanceof EmailTakenError || e instanceof LoginError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/logins");
  for (const id of r.added) revalidatePath(`/admin/clients/${id}`);
  const n = (k: number) => `${k} client${k === 1 ? "" : "s"}`;
  const ok = r.added.length
    ? `${email} can now see ${n(r.added.length)}${r.already.length ? ` (and already had ${n(r.already.length)})` : ""}.${r.created ? "" : " They already had a login, so their password is unchanged."}`
    : `${email} already had access to all ${n(r.already.length)} ticked. Nothing changed.`;
  return { ok, added: r.added, already: r.already, created: r.created, ...(r.created ? { email, password } : {}) };
}
