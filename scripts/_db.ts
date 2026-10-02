/** Shared by scripts: loads .env and opens Firestore the same way the app does, on first use. */
import "dotenv/config";
import type { Firestore } from "firebase-admin/firestore";
import { openFirestore } from "../src/db/core";

export const db: Firestore = new Proxy({} as Firestore, {
  get(_t, prop) {
    const real = openFirestore();
    const v = Reflect.get(real, prop, real);
    return typeof v === "function" ? v.bind(real) : v;
  },
});
