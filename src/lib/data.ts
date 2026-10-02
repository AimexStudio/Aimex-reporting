import "server-only";
import crypto from "node:crypto";
import { db, type Breakdowns, type ChannelEntry, type Client, type ImportDoc, type MonthDoc, type User } from "@/db";
import { deriveTotals, withDerived } from "./metrics";
import type { ParsedRow } from "./csv";

/* ---------------- refs ---------------- */

const clientsCol = () => db.collection("clients");
const usersCol = () => db.collection("users");
const emailRef = (email: string) => db.collection("emails").doc(encodeURIComponent(email.toLowerCase()));
const monthsCol = (clientId: string) => clientsCol().doc(clientId).collection("months");
const importsCol = (clientId: string) => clientsCol().doc(clientId).collection("imports");

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

export async function getClientLogin(clientId: string): Promise<User | null> {
  const q = await usersCol().where("clientId", "==", clientId).limit(1).get();
  const d = q.docs[0];
  return d ? ({ ...(d.data() as Omit<User, "id">), id: d.id }) : null;
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
      const months = (await monthsCol(c.id).select().get()).docs.map((m) => m.id).sort();
      const login = logins.find((u) => u.clientId === c.id);
      return {
        ...c,
        email: login?.email ?? null,
        lastLoginAt: login?.lastLoginAt ?? null,
        latestMonth: months.at(-1) ?? null,
        monthCount: months.length,
      };
    }),
  );
}

/* ---------------- monthly data ---------------- */

export interface MonthData {
  month: string;
  totals: Record<string, number>;
  channels: { channel: string; metrics: Record<string, number>; breakdowns: Breakdowns | null }[];
  note: string | null;
}

export interface DashboardData {
  client: { id: string; name: string; currency: string };
  months: MonthData[]; // oldest -> newest
}

/** Everything a client dashboard needs. For client users, clientId must come from the session, never the URL. */
export async function getDashboardData(clientId: string): Promise<DashboardData | null> {
  const client = await getClient(clientId);
  if (!client) return null;
  const snap = await monthsCol(clientId).get();
  const months: MonthData[] = snap.docs
    .map((d) => d.data() as MonthDoc)
    .filter((m) => m.channels?.length)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      const channels = m.channels.map((c) => ({ channel: c.channel, metrics: withDerived(c.metrics), breakdowns: c.breakdowns ?? null }));
      const totals = deriveTotals(m.channels.map((c) => c.metrics));
      channels.sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0) || a.channel.localeCompare(b.channel));
      return { month: m.month, totals, channels, note: m.note ?? null };
    });
  return { client: { id: client.id, name: client.name, currency: client.currency }, months };
}

export async function listImports(clientId: string): Promise<ImportDoc[]> {
  const s = await importsCol(clientId).orderBy("importedAt", "desc").limit(24).get();
  return s.docs.map((d) => ({ ...(d.data() as Omit<ImportDoc, "id">), id: d.id }));
}

/**
 * Stores parsed rows. For each month + channel in the file, the existing figures
 * are replaced, so re-uploading a corrected CSV is safe, and a Meta upload never
 * touches Google Ads figures already saved for the same month.
 */
export async function saveImport(opts: {
  clientId: string;
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
    const refs = [...byMonth.keys()].map((m) => monthsCol(opts.clientId).doc(m));
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
    tx.set(importsCol(opts.clientId).doc(importId), record);
  });
  return importId;
}

export async function saveMonthNote(clientId: string, month: string, body: string | null) {
  const ref = monthsCol(clientId).doc(month);
  const s = await ref.get();
  if (!s.exists) return false; // notes belong to months that have data
  await ref.update({ note: body, updatedAt: now() });
  return true;
}

export async function deleteMonth(clientId: string, month: string) {
  await monthsCol(clientId).doc(month).delete();
}
