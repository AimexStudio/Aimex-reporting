/**
 * npm run setup / npm run db:seed  -> creates the admin login from ADMIN_EMAIL / ADMIN_PASSWORD
 *                                     (only changes it if the password in .env changed)
 * npm run db:demo                  -> also creates a demo client with 12 months of sample data
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./_db";
import type { ChannelEntry, MonthDoc, User } from "../src/db/types";

const emailRef = (e: string) => db.collection("emails").doc(encodeURIComponent(e.toLowerCase()));

async function findUser(email: string): Promise<(User & { id: string }) | null> {
  const idx = await emailRef(email).get();
  if (!idx.exists) return null;
  const u = await db.collection("users").doc((idx.data() as { userId: string }).userId).get();
  return u.exists ? { ...(u.data() as User), id: u.id } : null;
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || email === "you@aimexstudio.com" || password === "change-this-password") {
    console.error("✗ Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first (see .env.example). Nothing was created.");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("✗ ADMIN_PASSWORD must be at least 10 characters. Nothing was created.");
    process.exit(1);
  }

  const existing = await findUser(email);
  if (existing) {
    if (existing.role === "admin" && (await bcrypt.compare(password, existing.passwordHash))) {
      console.log(`✓ Admin ${email} is up to date.`);
    } else {
      await db.collection("users").doc(existing.id).update({
        passwordHash: await bcrypt.hash(password, 12), role: "admin", clientId: null,
        sessionVersion: (existing.sessionVersion ?? 1) + 1,
      });
      console.log(`✓ Admin ${email} updated with the password from .env.`);
    }
  } else {
    const id = crypto.randomUUID();
    const user: Omit<User, "id"> = {
      email, passwordHash: await bcrypt.hash(password, 12), role: "admin", clientId: null,
      sessionVersion: 1, lastLoginAt: null, createdAt: Date.now(),
    };
    await db.collection("users").doc(id).set(user);
    await emailRef(email).set({ userId: id });
    console.log(`✓ Admin ${email} created.`);
  }

  if (process.argv.includes("--demo")) await demo();
}

async function demo() {
  const demoEmail = "demo@client.test";
  const old = await findUser(demoEmail);
  if (old?.clientId) await db.recursiveDelete(db.collection("clients").doc(old.clientId));
  if (old) await db.collection("users").doc(old.id).delete();

  const clientId = crypto.randomUUID();
  await db.collection("clients").doc(clientId).set({
    name: "Harbour & Vine Wine Co.", contactName: "Thandi Mokoena", currency: "ZAR", adminNotes: null, createdAt: Date.now(),
  });
  const pw = crypto.randomBytes(6).toString("base64url");
  const userId = crypto.randomUUID();
  const user: Omit<User, "id"> = {
    email: demoEmail, passwordHash: await bcrypt.hash(pw, 12), role: "client", clientId,
    sessionVersion: 1, lastLoginAt: null, createdAt: Date.now(),
  };
  await db.collection("users").doc(userId).set(user);
  await emailRef(demoEmail).set({ userId });
  const dash = db.collection("clients").doc(clientId).collection("dashboards").doc("main");
  await dash.set({ name: "Harbour & Vine Wine Co.", createdAt: Date.now() });

  const now = new Date();
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const g = 1 + (11 - i) * 0.035;
    const season = d.getUTCMonth() === 11 ? 1.35 : d.getUTCMonth() === 0 ? 0.8 : 1;
    const n = () => 0.9 + rand() * 0.2;
    const ch = (channel: string, m: Record<string, number>): ChannelEntry => ({
      channel, source: "csv", importId: null,
      metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)])),
    });
    const doc: MonthDoc = {
      month,
      updatedAt: Date.now(),
      note: i === 0
        ? "Search kept improving after we moved budget into the best-performing wine club keywords. Next month we test a new Meta video for the summer range."
        : null,
      channels: [
        ch("Google Ads", { spend: 14000 * g * n(), impressions: 115000 * g * season * n(), clicks: 3300 * g * season * n(), conversions: 150 * g * g * season * n(), revenue: 82000 * g * g * season * n() }),
        ch("Meta Ads", { spend: 9000 * g * n(), impressions: 290000 * g * season * n(), reach: 140000 * g * n(), clicks: 3900 * g * season * n(), conversions: 70 * g * season * n(), revenue: 33000 * g * season * n(), leads: 55 * g * n(), followers: 260 * g * n() }),
        ch("Website", { sessions: 7400 * g * season * n(), users: 5600 * g * season * n() }),
      ],
    };
    await dash.collection("months").doc(month).set(doc);
  }
  console.log(`✓ Demo client created. Log in as ${demoEmail} / ${pw}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("✗ " + (e?.message ?? e));
    console.error("  Run `npm run check:firebase` to test the Firebase connection.");
    process.exit(1);
  },
);
