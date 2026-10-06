import "server-only";
import crypto from "node:crypto";
import {
  db, type Breakdowns, type ChannelEntry, type Client, type DashboardDoc, type DashboardSettings, type ImportDoc,
  type MonthDoc, type SectionNotes, type User,
} from "@/db";
import { deriveTotals, monthLabel, withDerived } from "./metrics";
import type { ParsedRow } from "./csv";

/* ---------------- refs ---------------- */

const clientsCol = () => db.collection("clients");
const usersCol = () => db.collection("users");
const emailRef = (email: string) => db.collection("emails").doc(encodeURIComponent(email.toLowerCase()));
const dashCol = (clientId: string) => clientsCol().doc(clientId).collection("dashboards");
const monthsCol = (clientId: string, dashId: string) => dashCol(clientId).doc(dashId).collection("months");
const importsCol = (clientId: string, dashId: string) => dashCol(clientId).doc(dashId).collection("imports");
// Pre-dashboards layout, read only for the one-time move below.
const legacyMonthsCol = (clientId: string) => clientsCol().doc(clientId).collection("months");
const legacyImportsCol = (clientId: string) => clientsCol().doc(clientId).collection("imports");
const validId = (id: string) => !!id && !id.includes("/") && id.length < 200;

const newId = () => crypto.randomUUID();
const now = () => Date.now();

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`${email} already has an account.`);
  }
}

/* ---------------- users ---------------- */

export async function getUser(id: string): Promise<User | null> {
  const s = await usersCol().doc(id).get();
  return s.exists ? ({ ...(s.data() as Omit<User, "id">), id: s.id }) : null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const idx = await emailRef(email).get();
  if (!idx.exists) return null;
  return getUser((idx.data() as { userId: string }).userId);
}

/** The client's first login, used where one contact email is shown (e.g. the clients list). */
export async function getClientLogin(clientId: string): Promise<User | null> {
  return (await listClientUsers(clientId))[0] ?? null;
}

/** Every login that belongs to a client (viewers and client admins), oldest first. */
export async function listClientUsers(clientId: string): Promise<User[]> {
  const q = await usersCol().where("clientId", "==", clientId).get();
  return q.docs.map((d) => ({ ...(d.data() as Omit<User, "id">), id: d.id })).sort((a, b) => a.createdAt - b.createdAt);
}

export async function addClientUser(clientId: string, email: string, passwordHash: string, role: "client" | "client_admin"): Promise<User> {
  const id = newId();
  const user: Omit<User, "id"> = { email, passwordHash, role, clientId, sessionVersion: 1, lastLoginAt: null, createdAt: now() };
  await db.runTransaction(async (tx) => {
    const eRef = emailRef(email);
    if ((await tx.get(eRef)).exists) throw new EmailTakenError(email);
    tx.set(usersCol().doc(id), user);
    tx.set(eRef, { userId: id });
  });
  return { ...user, id };
}

/** Changes a client login between viewer and client admin. Signs them out so the new permission applies at once. */
export async function setClientUserRole(clientId: string, userId: string, role: "client" | "client_admin") {
  const u = await getUser(userId);
  if (!u || u.clientId !== clientId || u.role === "admin") throw new Error("That login doesn’t belong to this client.");
  await usersCol().doc(userId).update({ role, sessionVersion: (u.sessionVersion ?? 1) + 1 });
}

export async function removeClientUser(clientId: string, userId: string) {
  const u = await getUser(userId);
  if (!u || u.clientId !== clientId || u.role === "admin") throw new Error("That login doesn’t belong to this client.");
  await db.runTransaction(async (tx) => {
    tx.delete(usersCol().doc(userId));
    tx.delete(emailRef(u.email));
  });
}

export async function touchLogin(userId: string) {
  await usersCol().doc(userId).update({ lastLoginAt: now() });
}

export async function setPassword(userId: string, passwordHash: string) {
  await db.runTransaction(async (tx) => {
    const ref = usersCol().doc(userId);
    const s = await tx.get(ref);
    if (!s.exists) throw new Error("Account not found.");
    const v = (s.data() as User).sessionVersion ?? 1;
    tx.update(ref, { passwordHash, sessionVersion: v + 1 });
  });
}

/** Creates the admin, or updates it if the email exists. Returns what happened. */
export async function upsertAdmin(email: string, passwordHash: string, samePassword: (hash: string) => Promise<boolean>) {
  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.role === "admin" && (await samePassword(existing.passwordHash))) return "unchanged" as const;
    await usersCol().doc(existing.id).update({
      passwordHash, role: "admin", clientId: null, sessionVersion: (existing.sessionVersion ?? 1) + 1,
    });
    return "updated" as const;
  }
  const id = newId();
  await db.runTransaction(async (tx) => {
    const eRef = emailRef(email);
    if ((await tx.get(eRef)).exists) throw new EmailTakenError(email);
    const user: Omit<User, "id"> = { email, passwordHash, role: "admin", clientId: null, sessionVersion: 1, lastLoginAt: null, createdAt: now() };
    tx.set(usersCol().doc(id), user);
    tx.set(eRef, { userId: id });
  });
  return "created" as const;
}

/* ---------------- admin team ---------------- */

export async function listAdmins(): Promise<User[]> {
  const q = await usersCol().where("role", "==", "admin").get();
  return q.docs
    .map((d) => ({ ...(d.data() as Omit<User, "id">), id: d.id }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function createAdmin(email: string, passwordHash: string): Promise<User> {
  const id = newId();
  const user: Omit<User, "id"> = { email, passwordHash, role: "admin", clientId: null, sessionVersion: 1, lastLoginAt: null, createdAt: now() };
  await db.runTransaction(async (tx) => {
    const eRef = emailRef(email);
    if ((await tx.get(eRef)).exists) throw new EmailTakenError(email);
    tx.set(usersCol().doc(id), user);
    tx.set(eRef, { userId: id });
  });
  return { ...user, id };
}

/** Removes an admin login. Refuses to remove the last remaining admin. */
export async function removeAdmin(userId: string) {
  const admins = await listAdmins();
  const target = admins.find((a) => a.id === userId);
  if (!target) throw new Error("That admin no longer exists.");
  if (admins.length <= 1) throw new Error("You can’t remove the only admin.");
  await db.runTransaction(async (tx) => {
    tx.delete(usersCol().doc(userId));
    tx.delete(emailRef(target.email));
  });
}

/* ---------------- login throttle (shared across server instances) ---------------- */

const WINDOW = 15 * 60 * 1000;
const throttleRef = (key: string) => db.collection("loginThrottle").doc(crypto.createHash("sha256").update(key).digest("hex"));

export async function isThrottled(key: string, max = 8) {
  const s = await throttleRef(key).get();
  if (!s.exists) return false;
  const d = s.data() as { count: number; first: number };
  return now() - d.first < WINDOW && d.count >= max;
}

export async function recordFailure(key: string) {
  const ref = throttleRef(key);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? (s.data() as { count: number; first: number }) : null;
    tx.set(ref, d && now() - d.first < WINDOW ? { count: d.count + 1, first: d.first } : { count: 1, first: now() });
  });
}

export async function clearFailures(key: string) {
  await throttleRef(key).delete();
}

/* ---------------- clients ---------------- */

export async function getClient(id: string): Promise<Client | null> {
  if (!id || id.includes("/")) return null;
  const s = await clientsCol().doc(id).get();
  return s.exists ? ({ ...(s.data() as Omit<Client, "id">), id: s.id }) : null;
}

export async function createClientWithLogin(
  c: Omit<Client, "id" | "createdAt">,
  login: { email: string; passwordHash: string },
): Promise<Client> {
  const clientId = newId();
  const userId = newId();
  const client: Omit<Client, "id"> = { ...c, createdAt: now() };
  await db.runTransaction(async (tx) => {
    const eRef = emailRef(login.email);
    if ((await tx.get(eRef)).exists) throw new EmailTakenError(login.email);
    tx.set(clientsCol().doc(clientId), client);
    const user: Omit<User, "id"> = {
      email: login.email, passwordHash: login.passwordHash, role: "client", clientId,
      sessionVersion: 1, lastLoginAt: null, createdAt: now(),
    };
    tx.set(usersCol().doc(userId), user);
    tx.set(eRef, { userId });
  });
  return { ...client, id: clientId };
}

export async function updateClientFields(id: string, fields: Omit<Client, "id" | "createdAt" | "logo">) {
  await clientsCol().doc(id).update({ ...fields });
}

export async function setClientLogo(id: string, logo: string | null) {
  await clientsCol().doc(id).update({ logo });
}

export async function updateClientAndEmail(id: string, fields: Omit<Client, "id" | "createdAt">, email: string) {
  const login = await getClientLogin(id);
  await db.runTransaction(async (tx) => {
    const changing = login && login.email !== email;
    if (changing) {
      const nRef = emailRef(email);
      const taken = await tx.get(nRef);
      if (taken.exists && (taken.data() as { userId: string }).userId !== login.id) throw new EmailTakenError(email);
    }
    tx.update(clientsCol().doc(id), { ...fields });
    if (login && changing) {
      tx.delete(emailRef(login.email));
      tx.set(emailRef(email), { userId: login.id });
      tx.update(usersCol().doc(login.id), { email });
    }
  });
}

/** Deletes the client, their logins, and every month, note and upload record. */
export async function deleteClientCascade(id: string) {
  const logins = await usersCol().where("clientId", "==", id).get();
  for (const u of logins.docs) {
    const email = (u.data() as User).email;
    await emailRef(email).delete();
    await u.ref.delete();
  }
  await db.recursiveDelete(clientsCol().doc(id));
}

export async function listClients() {
  const [clientsSnap, loginsSnap] = await Promise.all([
    clientsCol().orderBy("name").get(),
    usersCol().where("role", "==", "client").get(),
  ]);
  const logins = loginsSnap.docs.map((d) => ({ ...(d.data() as Omit<User, "id">), id: d.id }));
  return Promise.all(
    clientsSnap.docs.map(async (d) => {
      const c = { ...(d.data() as Omit<Client, "id">), id: d.id };
      const dashboards = await getDashboards(c.id);
      const perDash = await Promise.all(dashboards.map(async (d) => (await monthsCol(c.id, d.id).select().get()).docs.map((m) => m.id)));
      const months = [...new Set(perDash.flat())].sort();
      // "behind" if any dashboard is missing its latest month
      const oldestLatest = perDash.map((ms) => ms.sort().at(-1) ?? "").sort()[0] ?? null;
      const login = logins.find((u) => u.clientId === c.id);
      return {
        ...c,
        email: login?.email ?? null,
        lastLoginAt: login?.lastLoginAt ?? null,
        latestMonth: months.at(-1) ?? null,
        oldestLatestMonth: oldestLatest || null,
        monthCount: months.length,
        dashboardCount: dashboards.length,
      };
    }),
  );
}

/* ---------------- dashboards (sub-companies / streams) ---------------- */

/**
 * The client's dashboards, oldest first. A client always has at least one: if none
 * exist yet, one is created (named after the client) and any older data stored
 * before dashboards existed is moved into it.
 */
export async function getDashboards(clientId: string): Promise<DashboardDoc[]> {
  const snap = await dashCol(clientId).get();
  if (!snap.empty) {
    return snap.docs
      .map((d) => ({ ...(d.data() as Omit<DashboardDoc, "id">), id: d.id }))
      .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
  }
  const client = await getClient(clientId);
  if (!client) return [];
  const main: DashboardDoc = { id: "main", name: client.name, createdAt: client.createdAt ?? now() };
  const [oldMonths, oldImports] = await Promise.all([legacyMonthsCol(clientId).get(), legacyImportsCol(clientId).get()]);
  await dashCol(clientId).doc("main").set({ name: main.name, createdAt: main.createdAt });
  for (const d of oldMonths.docs) {
    await monthsCol(clientId, "main").doc(d.id).set(d.data());
    await d.ref.delete();
  }
  for (const d of oldImports.docs) {
    await importsCol(clientId, "main").doc(d.id).set(d.data());
    await d.ref.delete();
  }
  return [main];
}

export async function getDashboard(clientId: string, dashId: string): Promise<DashboardDoc | null> {
  if (!validId(dashId)) return null;
  const all = await getDashboards(clientId);
  return all.find((d) => d.id === dashId) ?? null;
}

export async function createDashboard(clientId: string, name: string): Promise<DashboardDoc> {
  await getDashboards(clientId); // make sure older data has been moved first
  const d: DashboardDoc = { id: newId(), name, createdAt: now() };
  await dashCol(clientId).doc(d.id).set({ name: d.name, createdAt: d.createdAt });
  return d;
}

export async function renameDashboard(clientId: string, dashId: string, name: string) {
  if (!(await getDashboard(clientId, dashId))) throw new Error("That dashboard no longer exists.");
  await dashCol(clientId).doc(dashId).update({ name });
}

export async function saveDashboardSettings(clientId: string, dashId: string, settings: DashboardSettings) {
  if (!(await getDashboard(clientId, dashId))) throw new Error("That dashboard no longer exists.");
  const clean = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
  await dashCol(clientId).doc(dashId).update(clean);
}

/** Deletes a dashboard and all its months, notes and upload history. Refuses to delete the last one. */
export async function deleteDashboard(clientId: string, dashId: string) {
  const all = await getDashboards(clientId);
  if (!all.some((d) => d.id === dashId)) throw new Error("That dashboard no longer exists.");
  if (all.length <= 1) throw new Error("A client needs at least one dashboard.");
  await db.recursiveDelete(dashCol(clientId).doc(dashId));
}

/* ---------------- monthly data ---------------- */

export interface MonthData {
  month: string;
  totals: Record<string, number>;
  /** raw = the stored base figures, before rates are added */
  channels: { channel: string; metrics: Record<string, number>; breakdowns: Breakdowns | null; raw: Record<string, number> }[];
  note: string | null;
  sectionNotes: Record<string, SectionNotes>;
  goalActuals: Record<string, number>;
  /** Set when this month can't be fairly compared with the previous one (overview only). */
  compareNote?: string;
}

export interface DashboardData {
  client: { id: string; name: string; currency: string; logo: string | null };
  /** Goals, milestones, benchmark and planner defaults (single dashboards only). */
  settings: DashboardSettings;
  /** Which dashboard this is, or the combined overview. */
  scope: { kind: "dashboard"; id: string; name: string } | { kind: "overview"; name: string };
  months: MonthData[]; // oldest -> newest
}

/**
 * Everything one dashboard needs. For client users, clientId must come from the session,
 * never the URL; the dashboard is then looked up inside that client only.
 */
export async function getDashboardData(clientId: string, dashId: string): Promise<DashboardData | null> {
  const client = await getClient(clientId);
  if (!client) return null;
  const dash = await getDashboard(clientId, dashId);
  if (!dash) return null;
  const months = await loadMonths(clientId, dashId);
  const { id: _i, name: _n, createdAt: _c, ...settings } = dash;
  return {
    client: { id: client.id, name: client.name, currency: client.currency, logo: client.logo ?? null },
    settings,
    scope: { kind: "dashboard", id: dash.id, name: dash.name },
    months,
  };
}

/**
 * Combined view across all of a client's dashboards. Each dashboard appears as one
 * row in "Results by company", so the existing channel charts compare companies.
 */
export async function getOverviewData(clientId: string): Promise<DashboardData | null> {
  const client = await getClient(clientId);
  if (!client) return null;
  const dashboards = await getDashboards(clientId);
  const perDash = await Promise.all(dashboards.map(async (d) => ({ d, months: await loadMonths(clientId, d.id) })));
  const allMonths = [...new Set(perDash.flatMap((p) => p.months.map((m) => m.month)))].sort();
  const months: MonthData[] = allMonths.map((month) => {
    const rows = perDash
      .map(({ d, months }) => {
        const m = months.find((x) => x.month === month);
        if (!m) return null;
        // raw sums of the base figures for this company
        const base: Record<string, number> = {};
        for (const c of m.channels) for (const [k, v] of Object.entries(c.raw)) base[k] = (base[k] ?? 0) + v;
        return { channel: d.name, base };
      })
      .filter((x): x is { channel: string; base: Record<string, number> } => !!x);
    const channels = rows
      .map((r) => ({ channel: r.channel, metrics: withDerived(r.base), breakdowns: null, raw: r.base }))
      .sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0));
    // Rates across companies use each company's scoped channels, so mixed channel sets stay honest.
    const scopedChannels = perDash.flatMap(({ months }) => months.find((x) => x.month === month)?.channels.map((c) => c.raw) ?? []);
    return { month, totals: deriveTotals(scopedChannels), channels, note: null, sectionNotes: {}, goalActuals: {} };
  });
  // Month-on-month changes are only fair when the same companies have data in both months.
  months.forEach((m, i) => {
    if (i === 0) return;
    const prev = months[i - 1];
    const now = new Set(m.channels.map((c) => c.channel));
    const before = new Set(prev.channels.map((c) => c.channel));
    const missingBefore = [...now].filter((c) => !before.has(c));
    const missingNow = [...before].filter((c) => !now.has(c));
    if (missingBefore.length) {
      m.compareNote = `${missingBefore.join(" and ")} ${missingBefore.length === 1 ? "has" : "have"} no figures for ${monthLabel(prev.month)}, so changes from last month aren’t shown here. Each company’s own tab has its own comparison.`;
    } else if (missingNow.length) {
      m.compareNote = `${missingNow.join(" and ")} ${missingNow.length === 1 ? "has" : "have"} no figures for ${monthLabel(m.month)} yet, so changes from last month aren’t shown here.`;
    }
  });
  return {
    client: { id: client.id, name: client.name, currency: client.currency, logo: client.logo ?? null },
    settings: {},
    scope: { kind: "overview", name: "All companies" },
    months,
  };
}

/**
 * Cost per lead / conversion should only count spend that could produce them. If a channel's
 * breakdown has ad sets (or campaigns) that spent money but produced none of its results
 * (e.g. a blog ad set buying page views), their spend is left out of `result_spend`.
 */
function withResultSpend(metrics: Record<string, number>, b?: Breakdowns | null): Record<string, number> {
  const outcome = (metrics.leads ?? 0) > 0 ? "leads" : (metrics.conversions ?? 0) > 0 ? "conversions" : null;
  const rows = b?.adSets?.length ? b.adSets : b?.campaigns?.length ? b.campaigns : b?.ads;
  if (!outcome || !rows?.length || metrics.spend == null) return metrics;
  const producing = rows.filter((r) => (r.metrics[outcome] ?? 0) > 0);
  const excluded = rows.filter((r) => !((r.metrics[outcome] ?? 0) > 0)).reduce((t, r) => t + (r.metrics.spend ?? 0), 0);
  if (!producing.length || excluded <= 0) return metrics;
  return { ...metrics, result_spend: Math.max(0, metrics.spend - excluded) };
}

async function loadMonths(clientId: string, dashId: string): Promise<MonthData[]> {
  const snap = await monthsCol(clientId, dashId).get();
  return snap.docs
    .map((d) => d.data() as MonthDoc)
    .filter((m) => m.channels?.length)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      const raws = m.channels.map((c) => withResultSpend(c.metrics, c.breakdowns));
      const channels = m.channels.map((c, i) => ({ channel: c.channel, metrics: withDerived(raws[i]), breakdowns: c.breakdowns ?? null, raw: raws[i] }));
      const totals = deriveTotals(raws);
      channels.sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0) || a.channel.localeCompare(b.channel));
      return { month: m.month, totals, channels, note: m.note ?? null, sectionNotes: m.sectionNotes ?? {}, goalActuals: m.goalActuals ?? {} };
    });
}

export async function listImports(clientId: string, dashId: string): Promise<ImportDoc[]> {
  const s = await importsCol(clientId, dashId).orderBy("importedAt", "desc").limit(24).get();
  return s.docs.map((d) => ({ ...(d.data() as Omit<ImportDoc, "id">), id: d.id }));
}

/**
 * Stores parsed rows. For each month + channel in the file, the existing figures
 * are replaced, so re-uploading a corrected CSV is safe, and a Meta upload never
 * touches Google Ads figures already saved for the same month.
 */
export async function saveImport(opts: {
  clientId: string;
  dashboardId: string;
  rows: ParsedRow[];
  months: string[];
  filename: string | null;
  source?: string;
  note?: string;
  breakdowns?: Record<string, Breakdowns>;
}) {
  const source = opts.source ?? "csv";
  const importId = newId();
  const byMonth = new Map<string, Map<string, Record<string, number>>>();
  for (const r of opts.rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, new Map());
    const ch = byMonth.get(r.month)!;
    if (!ch.has(r.channel)) ch.set(r.channel, {});
    ch.get(r.channel)![r.metric] = r.value;
  }

  await db.runTransaction(async (tx) => {
    const refs = [...byMonth.keys()].map((m) => monthsCol(opts.clientId, opts.dashboardId).doc(m));
    const snaps = await Promise.all(refs.map((r) => tx.get(r))); // all reads before any write
    refs.forEach((ref, i) => {
      const month = ref.id;
      const existing = snaps[i].exists ? (snaps[i].data() as MonthDoc) : null;
      const incoming = byMonth.get(month)!;
      const kept = (existing?.channels ?? []).filter((c) => !incoming.has(c.channel));
      const added: ChannelEntry[] = [...incoming].map(([channel, metrics]) => ({
        channel, metrics, source, importId,
        ...(opts.breakdowns?.[`${month}|${channel}`] ? { breakdowns: opts.breakdowns[`${month}|${channel}`] } : {}),
      }));
      const note = opts.note && opts.months.length === 1 ? opts.note : (existing?.note ?? null);
      const doc: MonthDoc = { month, channels: [...kept, ...added], note, updatedAt: now() };
      tx.set(ref, doc);
    });
    const record: Omit<ImportDoc, "id"> = {
      months: opts.months,
      channels: [...new Set(opts.rows.map((r) => r.channel))],
      source,
      filename: opts.filename,
      rowCount: opts.rows.length,
      importedAt: now(),
    };
    tx.set(importsCol(opts.clientId, opts.dashboardId).doc(importId), record);
  });
  return importId;
}

export async function saveMonthNote(clientId: string, dashId: string, month: string, body: string | null) {
  if (!(await getDashboard(clientId, dashId))) return false;
  const ref = monthsCol(clientId, dashId).doc(month);
  const s = await ref.get();
  if (!s.exists) return false; // notes belong to months that have data
  await ref.update({ note: body, updatedAt: now() });
  return true;
}

/** Saves (or clears, with null) the written insights and warning for one section of one month. */
export async function saveSectionNotes(clientId: string, dashId: string, month: string, section: string, notes: SectionNotes | null) {
  if (!(await getDashboard(clientId, dashId))) return false;
  const ref = monthsCol(clientId, dashId).doc(month);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const all = { ...((s.data() as MonthDoc).sectionNotes ?? {}) };
    if (notes) all[section] = notes;
    else delete all[section];
    tx.update(ref, { sectionNotes: all, updatedAt: now() });
    return true;
  });
}

export async function saveGoalActuals(clientId: string, dashId: string, month: string, actuals: Record<string, number>) {
  if (!(await getDashboard(clientId, dashId))) return false;
  const ref = monthsCol(clientId, dashId).doc(month);
  const s = await ref.get();
  if (!s.exists) return false;
  await ref.update({ goalActuals: actuals, updatedAt: now() });
  return true;
}

export async function deleteMonth(clientId: string, dashId: string, month: string) {
  if (!(await getDashboard(clientId, dashId))) return;
  await monthsCol(clientId, dashId).doc(month).delete();
}
