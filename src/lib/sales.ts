/** Helpers for hand-entered sales figures. Pure: safe on server and client. */
import type { SalesRow, SalesSnapshot } from "@/db/types";

export const DEFAULT_STATUSES = ["Available", "Reserved", "Sold", "Granted", "Bankable"];

const COLORS: Record<string, string> = {
  available: "#2E8B3A",
  reserved: "#C99700",
  sold: "#D6312B",
  granted: "#D4823A",
  bankable: "#8B1E2D",
  pending: "#C99700",
  submitted: "#7A5C99",
  registered: "#3D6FD6",
  transferred: "#3D6FD6",
};
const FALLBACK = ["#0E1320", "#3D6FD6", "#7A5C99", "#8A94A6", "#4B5563"];

export function statusColor(status: string, i = 0): string {
  return COLORS[status.trim().toLowerCase()] ?? FALLBACK[i % FALLBACK.length];
}

export const isAvailable = (status: string) => /^(available|unsold|open)$/i.test(status.trim());

export function summarize(rows: SalesRow[]) {
  const total = {
    units: rows.reduce((t, r) => t + r.units, 0),
    value: rows.some((r) => r.value != null) ? rows.reduce((t, r) => t + (r.value ?? 0), 0) : null,
    size: rows.some((r) => r.size != null) ? rows.reduce((t, r) => t + (r.size ?? 0), 0) : null,
  };
  const available = rows.find((r) => isAvailable(r.status));
  // "Committed" = everything that isn't available (reserved, sold, granted, bankable, ...)
  const committed = available
    ? { units: total.units - available.units, value: total.value != null ? total.value - (available.value ?? 0) : null }
    : null;
  return { total, available, committed };
}

/** The snapshot for a month, or the latest one before it ("as at" that month). */
export function snapshotFor(sales: Record<string, SalesSnapshot> | undefined, month: string): SalesSnapshot | null {
  const months = Object.keys(sales ?? {}).sort();
  if (!months.length) return null;
  const at = months.filter((m) => !month || m <= month).at(-1) ?? months[0];
  return sales![at];
}

export function previousSnapshot(sales: Record<string, SalesSnapshot> | undefined, month: string): SalesSnapshot | null {
  const months = Object.keys(sales ?? {}).sort().filter((m) => m < month);
  return months.length ? sales![months.at(-1)!] : null;
}
