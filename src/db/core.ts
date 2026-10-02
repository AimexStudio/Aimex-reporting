/**
 * Firestore connection. No "server-only" import here so scripts (seed, check) can use it too.
 *
 * Credentials, first match wins:
 *   FIREBASE_SERVICE_ACCOUNT_BASE64  service-account JSON, base64 encoded (best for Vercel/Railway)
 *   FIREBASE_SERVICE_ACCOUNT_FILE    path to the downloaded service-account JSON (easiest locally)
 *   neither                          Google default credentials (automatic on Firebase App Hosting / Cloud Run)
 */
import fs from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp, applicationDefault, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function credentialFromEnv() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (b64) return cert(JSON.parse(Buffer.from(b64, "base64").toString("utf8")));
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
  if (file) {
    const p = path.resolve(/* turbopackIgnore: true */ process.cwd(), file);
    if (!fs.existsSync(p)) {
      throw new Error(
        `No service-account key at ${p}. Download it from Firebase console → Project settings → Service accounts → Generate new private key, and save it there.`,
      );
    }
    return cert(JSON.parse(fs.readFileSync(p, "utf8")));
  }
  return applicationDefault();
}

export function openFirestore(): Firestore {
  if (process.env.FIRESTORE_FAKE_FILE) {
    // Test-only stand-in, never used unless this variable is set.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("./fake-firestore").fakeFirestore(process.env.FIRESTORE_FAKE_FILE) as Firestore;
  }
  const g = globalThis as unknown as { __aimexFs?: Firestore };
  if (g.__aimexFs) return g.__aimexFs;
  const app: App =
    getApps()[0] ??
    initializeApp({
      credential: credentialFromEnv(),
      projectId: process.env.FIREBASE_PROJECT_ID || undefined,
    });
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  g.__aimexFs = db;
  return db;
}
