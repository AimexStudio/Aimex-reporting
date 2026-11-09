import "server-only";
import crypto from "node:crypto";
import {
  db, type Breakdowns, type ChannelEntry, type Client, type DashboardDoc, type DashboardSettings, type ImportDoc,
  type MonthDoc, type SalesRow, type SectionNotes, type User,
} from "@/db";
import { deriveTotals, monthLabel, withDerived } from "./metrics";
import { kindOf, words, type PeriodKind } from "./period";
import { clientCategory, type ClientCategory } from "./category";
import type { RoomSnapshot } from "./room-sales";
import { cleanChannels } from "./marketing-channels";
import { membershipFields, membershipsOf, type ClientRole } from "./memberships";
import type { ParsedRow } from "./csv";

/* ---------------- refs ---------------- */

const clientsCol = () => db.collection("clients");
const usersCol = () => db.collection("users");
const emailRef = (email: string) => db.collection("emails").doc(encodeURIComponent(email.toLowerCase()));
const dashCol = (clientId: string) => clientsCol().doc(clientId).collection("dashboards");
const monthsCol = (clientId: string, dashId: string) => dashCol(clientId).doc(dashId).collection("months");
/** Monthly figures live in "months", weekly figures in "weeks", side by side. */
const periodsCol = (clientId: string, dashId: string, kind: PeriodKind) => dashCol(clientId).doc(dashId).collection(kind === "week" ? "weeks" : "months");
const periodDoc = (clientId: string, dashId: string, id: string) => periodsCol(clientId, dashId, kindOf(id)).doc(id);
const importsCol = (clientId: string, dashId: string) => dashCol(clientId).doc(dashId).collection("imports");
/** Uploaded files themselves, stored in pieces (a Firestore document holds at most 1 MB). */
const filesCol = (clientId: string, dashId: string) => dashCol(clientId).doc(dashId).collection("files");
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

/**
 * Every login that can see a client (viewers and client admins), oldest first. Each is returned with
 * `role` set to its permission for THIS client, and `otherClients` = how many other clients it can see.
 */
export async function listClientUsers(clientId: string): Promise<(User & { otherClients: number })[]> {
  const [byList, byLegacy] = await Promise.all([
    usersCol().where("clientIds", "array-contains", clientId).get(),
    usersCol().where("clientId", "==", clientId).get(),
  ]);
  const seen = new Map<string, User>();
  for (const d of [...byList.docs, ...byLegacy.docs]) seen.set(d.id, { ...(d.data() as Omit<User, "id">), id: d.id });
  return [...seen.values()]
    .map((u) => ({ u, m: membershipsOf(u) }))
    .filter(({ m }) => m[clientId])
    .map(({ u, m }) => ({ ...u, role: m[clientId], otherClients: Object.keys(m).length - 1 }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Gives an email access to a client. A new email gets a new login (with this password);
 * an existing client login just gains this client, keeping its own password.
 */
export async function addClientUser(clientId: string, email: string, passwordHash: string, role: ClientRole): Promise<{ user: User; existing: boolean }> {
  return db.runTransaction(async (tx) => {
    const eRef = emailRef(email);
    const e = await tx.get(eRef);
    if (e.exists) {
      const uRef = usersCol().doc((e.data() as { userId: string }).userId);
      const us = await tx.get(uRef);
      const u = { ...(us.data() as Omit<User, "id">), id: uRef.id };
      if (u.role === "admin") throw new LoginError(`${email} is a super admin and can already see every client.`);
      const m = membershipsOf(u);
      if (m[clientId]) throw new LoginError(`${email} already has access to this client.`);
      const f = membershipFields({ ...m, [clientId]: role });
      // A changed overall role means a new sign-in, so the session always matches the permissions.
      tx.update(uRef, { ...f, ...(f.role !== u.role ? { sessionVersion: (u.sessionVersion ?? 1) + 1 } : {}) });
      return { user: { ...u, ...f }, existing: true };
    }
    const id = newId();
    const user: Omit<User, "id"> = { email, passwordHash, ...membershipFields({ [clientId]: role }), sessionVersion: 1, lastLoginAt: null, createdAt: now() };
    tx.set(usersCol().doc(id), user);
    tx.set(eRef, { userId: id });
    return { user: { ...user, id }, existing: false };
  });
}

/**
 * Gives one email access to several clients at once. The first client creates the login if it's new
 * (with this password); the rest just add access. Returns what happened for each client.
 */
export async function addUserToClients(email: string, passwordHash: string, entries: { clientId: string; role: ClientRole }[]) {
  const added: string[] = [], already: string[] = [];
  let created = false;
  for (const e of entries) {
    try {
      const r = await addClientUser(e.clientId, email, passwordHash, e.role);
      added.push(e.clientId);
      if (!r.existing) created = true;
    } catch (err) {
      if (err instanceof LoginError && /already has access/.test(err.message)) already.push(e.clientId);
      else throw err;
    }
  }
  return { created, added, already };
}

/** Every client login (not super admins) with its clients and permissions, by email. */
export async function listClientLogins(): Promise<{ id: string; email: string; lastLoginAt: number | null; memberships: Record<string, ClientRole> }[]> {
  const q = await usersCol().get();
  return q.docs
    .map((d) => ({ ...(d.data() as Omit<User, "id">), id: d.id }))
    .filter((u) => u.role !== "admin")
    .map((u) => ({ id: u.id, email: u.email, lastLoginAt: u.lastLoginAt ?? null, memberships: membershipsOf(u) }))
    .filter((u) => Object.keys(u.memberships).length)
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** A readable reason a login change can't be made. */
export class LoginError extends Error {}

/** Changes a login's permission for one client. Signs them out so the new permission applies at once. */
export async function setClientUserRole(clientId: string, userId: string, role: ClientRole) {
  const u = await getUser(userId);
  const m = u ? membershipsOf(u) : {};
  if (!u || !m[clientId]) throw new Error("That login doesn’t belong to this client.");
  await usersCol().doc(userId).update({ ...membershipFields({ ...m, [clientId]: role }), sessionVersion: (u.sessionVersion ?? 1) + 1 });
}

/** Takes a client away from a login; the login itself is deleted only when it has no clients left. */
export async function removeClientUser(clientId: string, userId: string) {
  const u = await getUser(userId);
  const m = u ? { ...membershipsOf(u) } : {};
  if (!u || !m[clientId]) throw new Error("That login doesn’t belong to this client.");
  delete m[clientId];
  await db.runTransaction(async (tx) => {
    if (!Object.keys(m).length) {
      tx.delete(usersCol().doc(userId));
      tx.delete(emailRef(u.email));
    } else {
      tx.update(usersCol().doc(userId), { ...membershipFields(m), sessionVersion: (u.sessionVersion ?? 1) + 1 });
    }
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
): Promise<{ client: Client; existingLogin: boolean }> {
  const clientId = newId();
  const client: Omit<Client, "id"> = { ...c, createdAt: now() };
  await clientsCol().doc(clientId).set(client);
  try {
    const r = await addClientUser(clientId, login.email, login.passwordHash, "client");
    return { client: { ...client, id: clientId }, existingLogin: r.existing };
  } catch (e) {
    await clientsCol().doc(clientId).delete(); // nothing half-made is left behind
    throw e;
  }
}

export async function updateClientFields(id: string, fields: Omit<Client, "id" | "createdAt" | "logo" | "period">) {
  await clientsCol().doc(id).update({ ...fields });
}

export async function setReportingPeriod(id: string, period: PeriodKind) {
  await clientsCol().doc(id).update({ period });
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
  for (const u of await listClientUsers(id)) await removeClientUser(id, u.id);
  await db.recursiveDelete(clientsCol().doc(id));
}

export async function listClients() {
  const [clientsSnap, loginsSnap] = await Promise.all([
    clientsCol().orderBy("name").get(),
    usersCol().get(),
  ]);
  const logins = loginsSnap.docs.map((d) => ({ ...(d.data() as Omit<User, "id">), id: d.id }));
  return Promise.all(
    clientsSnap.docs.map(async (d) => {
      const c = { ...(d.data() as Omit<Client, "id">), id: d.id };
      const dashboards = await getDashboards(c.id);
      const perDash = await Promise.all(dashboards.map(async (d) => (await periodsCol(c.id, d.id, "month").select().get()).docs.map((m) => m.id)));
      const weekIds = (await Promise.all(dashboards.map(async (d) => (await periodsCol(c.id, d.id, "week").select().get()).docs.map((m) => m.id)))).flat();
      const weeksSorted = [...new Set(weekIds)].sort();
      const months = [...new Set(perDash.flat())].sort();
      // "behind" if any dashboard is missing its latest month
      const oldestLatest = perDash.map((ms) => ms.sort().at(-1) ?? "").sort()[0] ?? null;
      const login = logins.filter((u) => membershipsOf(u)[c.id]).sort((x, y) => x.createdAt - y.createdAt)[0];
      // Older clients get their category saved once, so it no longer depends on their name.
      const category: ClientCategory = clientCategory(c);
      if (!c.category) await clientsCol().doc(c.id).update({ category });
      return {
        category,
        ...c,
        email: login?.email ?? null,
        lastLoginAt: login?.lastLoginAt ?? null,
        latestMonth: months.at(-1) ?? null,
        oldestLatestMonth: oldestLatest || null,
        latestWeek: weeksSorted.at(-1) ?? null,
        weekCount: weeksSorted.length,
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

/** Sets the comment on one saved sales snapshot ("sales", by period) or room sales report ("roomSales", by date). */
export async function setSnapshotComment(clientId: string, dashId: string, field: "sales" | "roomSales", key: string, comment: string | null) {
  const ref = dashCol(clientId).doc(dashId);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const all = { ...(((s.data() as DashboardDoc)[field] ?? {}) as Record<string, { comment?: string | null }>) };
    if (!all[key]) return false;
    all[key] = { ...all[key], comment };
    tx.update(ref, { [field]: all });
    return true;
  });
}

/** Saves (or, with null, removes) a room sales upload, keyed by its reporting date. Keeps the latest 60. */
export async function saveRoomSales(clientId: string, dashId: string, reportDate: string, snap: RoomSnapshot | null) {
  const ref = dashCol(clientId).doc(dashId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new Error("That dashboard no longer exists.");
    const all = { ...((s.data() as DashboardDoc).roomSales ?? {}) };
    if (snap) all[reportDate] = { ...snap, comment: snap.comment ?? all[reportDate]?.comment ?? null, updatedAt: now() };
    else delete all[reportDate];
    const keep = Object.keys(all).sort().slice(-60);
    tx.update(ref, { roomSales: Object.fromEntries(keep.map((k) => [k, all[k]])) });
  });
}

/** Saves (or, with null, removes) the hand-entered sales snapshot for one month of a dashboard. */
export async function saveSalesSnapshot(clientId: string, dashId: string, month: string, rows: SalesRow[] | null, filename: string | null = null, comment: string | null = null) {
  const ref = dashCol(clientId).doc(dashId);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new Error("That dashboard no longer exists.");
    const sales = { ...((s.data() as DashboardDoc).sales ?? {}) };
    if (rows) sales[month] = { month, rows, filename, comment: comment ?? sales[month]?.comment ?? null, updatedAt: now() };
    else delete sales[month];
    tx.update(ref, { sales });
  });
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
  /** Set when this month can't be fairly compared with the previous one. */
  compareNote?: string;
  /** Channels with only part of this month's figures so far. */
  partial: Record<string, string>;
}

export interface DashboardData {
  client: { id: string; name: string; currency: string; logo: string | null; category: ClientCategory };
  /** Goals, milestones, benchmark and planner defaults (single dashboards only). */
  settings: DashboardSettings;
  /** Which dashboard this is, or the combined overview. */
  scope: { kind: "dashboard"; id: string; name: string } | { kind: "overview"; name: string };
  months: MonthData[]; // monthly figures, oldest -> newest
  /** Weekly figures (uploads marked weekly), oldest -> newest. Shown in the report's weekly view. */
  weeks: MonthData[];
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
  const [months, weeks] = await Promise.all([loadMonths(clientId, dashId, "month"), loadMonths(clientId, dashId, "week")]);
  const { id: _i, name: _n, createdAt: _c, ...settings } = dash;
  return {
    client: { id: client.id, name: client.name, currency: client.currency, logo: client.logo ?? null, category: clientCategory(client) },
    settings,
    scope: { kind: "dashboard", id: dash.id, name: dash.name },
    months,
    weeks,
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
  const [months, weeks] = await Promise.all([overviewPeriods(clientId, dashboards, "month"), overviewPeriods(clientId, dashboards, "week")]);
  return {
    client: { id: client.id, name: client.name, currency: client.currency, logo: client.logo ?? null, category: clientCategory(client) },
    // The group overview shows every channel used by any of its companies.
    settings: { marketingChannels: cleanChannels(dashboards.flatMap((d) => d.marketingChannels ?? [])) },
    scope: { kind: "overview", name: "All companies" },
    months,
    weeks,
  };
}

/** One row per company for each period of one kind (monthly or weekly). */
async function overviewPeriods(clientId: string, dashboards: DashboardDoc[], kind: PeriodKind): Promise<MonthData[]> {
  const perDash = await Promise.all(dashboards.map(async (d) => ({ d, months: await loadMonths(clientId, d.id, kind) })));
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
    const partial = Object.assign({}, ...perDash.map(({ months }) => months.find((x) => x.month === month)?.partial ?? {}));
    return { month, totals: deriveTotals(scopedChannels), channels, note: null, sectionNotes: {}, goalActuals: {}, partial,
      compareNote: Object.keys(partial).length ? `Some figures cover only part of ${monthLabel(month)} so far, so changes from ${words(kind).last} aren’t shown.` : undefined };
  });
  // Month-on-month changes are only fair when the same companies have data in both months.
  months.forEach((m, i) => {
    if (i === 0 || m.compareNote) return;
    const prev = months[i - 1];
    const now = new Set(m.channels.map((c) => c.channel));
    const before = new Set(prev.channels.map((c) => c.channel));
    const missingBefore = [...now].filter((c) => !before.has(c));
    const missingNow = [...before].filter((c) => !now.has(c));
    if (missingBefore.length) {
      m.compareNote = `${missingBefore.join(" and ")} ${missingBefore.length === 1 ? "has" : "have"} no figures for ${monthLabel(prev.month)}, so changes from ${words(kindOf(m.month)).last} aren’t shown here. Each company’s own tab has its own comparison.`;
    } else if (missingNow.length) {
      m.compareNote = `${missingNow.join(" and ")} ${missingNow.length === 1 ? "has" : "have"} no figures for ${monthLabel(m.month)} yet, so changes from ${words(kindOf(m.month)).last} aren’t shown here.`;
    }
  });
  return months;
}

/**
 * The reports focus on leads. A channel's "conversions" with no sales value attached
 * (e.g. Google Ads form fills) are enquiries, so they're shown as leads. Conversions
 * that carry revenue are real sales and stay as conversions.
 */
function leadsFocus(metrics: Record<string, number>, b: Breakdowns | null): { metrics: Record<string, number>; breakdowns: Breakdowns | null } {
  if (!((metrics.conversions ?? 0) > 0) || metrics.leads != null || (metrics.revenue ?? 0) > 0) return { metrics, breakdowns: b };
  const move = (m: Record<string, number>) => {
    if (m.conversions == null) return m;
    const { conversions, ...rest } = m;
    return { ...rest, leads: (rest.leads ?? 0) + conversions };
  };
  const rows = <T extends { metrics: Record<string, number> }>(list?: T[]) => list?.map((r) => ({ ...r, metrics: move(r.metrics) }));
  return {
    metrics: move(metrics),
    breakdowns: b ? { ...b, ads: rows(b.ads), adSets: rows(b.adSets), campaigns: rows(b.campaigns), audiences: rows(b.audiences), sources: rows(b.sources), branches: rows(b.branches) } : null,
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

async function loadMonths(clientId: string, dashId: string, kind: PeriodKind = "month"): Promise<MonthData[]> {
  const snap = await periodsCol(clientId, dashId, kind).get();
  const list = snap.docs
    .map((d) => d.data() as MonthDoc)
    .filter((m) => m.channels?.length)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      const focused = m.channels.map((c) => leadsFocus(c.metrics, c.breakdowns ?? null));
      const raws = focused.map((f) => withResultSpend(f.metrics, f.breakdowns));
      const channels = m.channels.map((c, i) => ({ channel: c.channel, metrics: withDerived(raws[i]), breakdowns: focused[i].breakdowns, raw: raws[i] }));
      const totals = deriveTotals(raws);
      channels.sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0) || a.channel.localeCompare(b.channel));
      const partial = m.partial ?? {};
      const parts = Object.entries(partial);
      const compareNote = parts.length
        ? `${parts.map(([c, r]) => `${c} covers ${r} only`).join("; ")}, so this month isn’t complete yet and changes from last month aren’t shown.`
        : undefined;
      return { month: m.month, totals, channels, note: m.note ?? null, sectionNotes: m.sectionNotes ?? {}, goalActuals: m.goalActuals ?? {}, partial, compareNote };
    });
  // Totals are only compared when the same channels have figures in both periods; otherwise
  // a channel uploaded in one period but not the other would show up as growth or decline.
  list.forEach((m, k) => {
    if (k === 0 || m.compareNote) return;
    const now = new Set(m.channels.map((c) => c.channel));
    const before = new Set(list[k - 1].channels.map((c) => c.channel));
    const onlyNow = [...now].filter((c) => !before.has(c));
    const onlyBefore = [...before].filter((c) => !now.has(c));
    if (!onlyNow.length && !onlyBefore.length) return;
    const unit = words(kind);
    const missing = onlyNow.length
      ? `${onlyNow.join(" and ")} ${onlyNow.length === 1 ? "has" : "have"} no figures for ${monthLabel(list[k - 1].month)}`
      : `${onlyBefore.join(" and ")} ${onlyBefore.length === 1 ? "has" : "have"} no figures for ${monthLabel(m.month)} yet`;
    m.compareNote = `${missing}, so changes from ${unit.last} aren’t shown for the totals. Each channel’s own page compares like with like.`;
  });
  return list;
}

/* ---------------- uploaded files (originals) ---------------- */

export interface StoredFile { filename: string; contentType: string; encoding: "utf8" | "base64"; data: string }
const PIECE = 700_000; // characters per piece, well under Firestore's 1 MB per document

/**
 * Keeps an uploaded file, keyed by what it belongs to: an import id, "sales:<period>" or "rooms:<date>".
 * Saving again under the same key replaces it.
 */
export async function saveStoredFile(clientId: string, dashId: string, key: string, f: StoredFile) {
  const ref = filesCol(clientId, dashId).doc(key);
  await deleteStoredFile(clientId, dashId, key);
  // Text is stored without a byte-order mark; downloads add exactly one, so spreadsheets read it as UTF-8.
  if (f.encoding === "utf8") f = { ...f, data: f.data.replace(/^\uFEFF/, "") };
  const pieces = Math.max(1, Math.ceil(f.data.length / PIECE));
  for (let i = 0; i < pieces; i++) await ref.collection("pieces").doc(String(i)).set({ data: f.data.slice(i * PIECE, (i + 1) * PIECE) });
  await ref.set({ filename: f.filename.slice(0, 160), contentType: f.contentType, encoding: f.encoding, pieces, size: f.data.length, savedAt: now() });
}

export async function getStoredFile(clientId: string, dashId: string, key: string): Promise<StoredFile | null> {
  const s = await filesCol(clientId, dashId).doc(key).get();
  if (!s.exists) return null;
  const m = s.data() as { filename: string; contentType: string; encoding: "utf8" | "base64"; pieces: number };
  const parts = await Promise.all(Array.from({ length: m.pieces }, (_, i) => s.ref.collection("pieces").doc(String(i)).get()));
  if (parts.some((p) => !p.exists)) return null;
  return { filename: m.filename, contentType: m.contentType, encoding: m.encoding, data: parts.map((p) => (p.data() as { data: string }).data).join("") };
}

/** The keys of every file kept for a dashboard (import ids, "sales:…", "rooms:…"). */
export async function listStoredFiles(clientId: string, dashId: string): Promise<string[]> {
  return (await filesCol(clientId, dashId).select().get()).docs.map((d) => d.id);
}

/** Marks an upload in the history as having its file kept. */
export async function markImportHasFile(clientId: string, dashId: string, importId: string) {
  await importsCol(clientId, dashId).doc(importId).update({ hasFile: true });
}

export async function hasStoredFile(clientId: string, dashId: string, key: string) {
  return (await filesCol(clientId, dashId).doc(key).get()).exists;
}

export async function deleteStoredFile(clientId: string, dashId: string, key: string) {
  const ref = filesCol(clientId, dashId).doc(key);
  const s = await ref.get();
  if (!s.exists) return;
  const n = (s.data() as { pieces?: number }).pieces ?? 0;
  for (let i = 0; i < n; i++) await ref.collection("pieces").doc(String(i)).delete();
  await ref.delete();
}

/** One month's or week's stored figures, for exporting. */
export async function getPeriod(clientId: string, dashId: string, period: string): Promise<MonthDoc | null> {
  const s = await periodDoc(clientId, dashId, period).get();
  return s.exists ? (s.data() as MonthDoc) : null;
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
  partialMonths?: Record<string, string>;
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
    const refs = [...byMonth.keys()].map((m) => periodDoc(opts.clientId, opts.dashboardId, m));
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
      // A channel's figures that cover only part of the month are marked; a full upload clears the mark.
      const partial = { ...(existing?.partial ?? {}) };
      for (const ch of incoming.keys()) {
        if (opts.partialMonths?.[month]) partial[ch] = opts.partialMonths[month];
        else delete partial[ch];
      }
      const doc: MonthDoc = { month, channels: [...kept, ...added], note, partial, updatedAt: now() };
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
  const ref = periodDoc(clientId, dashId, month);
  const s = await ref.get();
  if (!s.exists) return false; // notes belong to months that have data
  await ref.update({ note: body, updatedAt: now() });
  return true;
}

/** Saves (or clears, with null) the written insights and warning for one section of one month. */
export async function saveSectionNotes(clientId: string, dashId: string, month: string, section: string, notes: SectionNotes | null) {
  if (!(await getDashboard(clientId, dashId))) return false;
  const ref = periodDoc(clientId, dashId, month);
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
  const ref = periodDoc(clientId, dashId, month);
  const s = await ref.get();
  if (!s.exists) return false;
  await ref.update({ goalActuals: actuals, updatedAt: now() });
  return true;
}

/**
 * Removes one channel's figures (and its notes and partial-month mark) from one month or week.
 * If it was the only channel, the whole period is removed.
 */
export async function removeChannelFromPeriod(clientId: string, dashId: string, period: string, channel: string) {
  if (!(await getDashboard(clientId, dashId))) return false;
  const ref = periodDoc(clientId, dashId, period);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const m = s.data() as MonthDoc;
    const channels = (m.channels ?? []).filter((c) => c.channel !== channel);
    if (channels.length === (m.channels ?? []).length) return false;
    if (!channels.length) { tx.delete(ref); return true; }
    const sectionNotes = { ...(m.sectionNotes ?? {}) }; delete sectionNotes[channel];
    const partial = { ...(m.partial ?? {}) }; delete partial[channel];
    tx.update(ref, { channels, sectionNotes, partial, updatedAt: now() });
    return true;
  });
}

export async function deleteMonth(clientId: string, dashId: string, month: string) {
  if (!(await getDashboard(clientId, dashId))) return;
  await periodDoc(clientId, dashId, month).delete();
}
