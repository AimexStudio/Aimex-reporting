/** npm run firebase:env — prints the service-account key as one line for hosting dashboards. */
import "dotenv/config";
import fs from "node:fs";
const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE ?? "./firebase-service-account.json";
if (!fs.existsSync(file)) { console.error(`✗ ${file} not found.`); process.exit(1); }
const b64 = Buffer.from(fs.readFileSync(file, "utf8")).toString("base64");
console.log("Add this environment variable on your host (keep it secret):\n");
console.log(`FIREBASE_SERVICE_ACCOUNT_BASE64=${b64}`);
