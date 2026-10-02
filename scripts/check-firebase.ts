/** npm run check:firebase — confirms the app can write to and read from Firestore. */
import { db } from "./_db";

async function main() {
  const ref = db.collection("_health").doc("check");
  const stamp = Date.now();
  await ref.set({ stamp });
  const back = (await ref.get()).data();
  await ref.delete();
  if (back?.stamp !== stamp) throw new Error("Wrote to Firestore but read back something different.");
  const users = await db.collection("users").select().get();
  console.log(`✓ Connected to Firestore${process.env.FIREBASE_PROJECT_ID ? ` (project ${process.env.FIREBASE_PROJECT_ID})` : ""}. ${users.size} login account${users.size === 1 ? "" : "s"} found.`);
}

main().then(
  () => process.exit(0),
  (e: { message?: string; code?: number | string }) => {
    const msg = e?.message ?? String(e);
    console.error("✗ Couldn't connect to Firestore: " + msg);
    if (/Could not load the default credentials/i.test(msg))
      console.error("  Set FIREBASE_SERVICE_ACCOUNT_FILE in .env to the path of your downloaded service-account JSON.");
    if (/NOT_FOUND|5 NOT_FOUND|database.*does not exist/i.test(msg))
      console.error("  Create the Firestore database first: Firebase console → Build → Firestore Database → Create database.");
    if (/PERMISSION_DENIED|7 PERMISSION/i.test(msg))
      console.error("  The service account lacks access. Generate the key from this project's Project settings → Service accounts.");
    process.exit(1);
  },
);
