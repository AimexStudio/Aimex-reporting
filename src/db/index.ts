import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { openFirestore } from "./core";

/**
 * Connects on first use, not on import, so `next build` works without credentials
 * (hosts build before secrets are available) and errors surface where they're handled.
 */
export const db: Firestore = new Proxy({} as Firestore, {
  get(_t, prop) {
    const real = openFirestore();
    const v = Reflect.get(real, prop, real);
    return typeof v === "function" ? v.bind(real) : v;
  },
});

export * from "./types";
