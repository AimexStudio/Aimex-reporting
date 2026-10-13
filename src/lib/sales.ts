/** Helpers for hand-entered sales figures. Pure: safe on server and client. */
import type { SalesRow, SalesSnapshot } from "@/db/types";
import { isWeekId, kindOf, type PeriodKind } from "./period";

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

/** Snapshots of one kind only: monthly keys ("2026-09") or weekly keys ("2026-W41"). */
function keysOf(sales: Record<string, SalesSnapshot> | undefined, kind: PeriodKind): string[] {
  return Object.keys(sales ?? {}).filter((k) => (kind === "week" ? isWeekId(k) : !isWeekId(k))).sort();
}

/** The snapshot for a period, or the latest one of the same kind before it ("as at" that period). */
export function snapshotFor(sales: Record<string, SalesSnapshot> | undefined, period: string, kind: PeriodKind = kindOf(period || "2000-01")): SalesSnapshot | null {
  const keys = keysOf(sales, kind);
  if (!keys.length) return null;
  // "As at" a period: the latest figures up to it. Figures from a later period are never shown for an earlier one.
  const at = period ? keys.filter((k) => k <= period).at(-1) : keys.at(-1);
  return at ? sales![at] : null;
}

export function previousSnapshot(sales: Record<string, SalesSnapshot> | undefined, period: string): SalesSnapshot | null {
  const keys = keysOf(sales, kindOf(period)).filter((k) => k < period);
  return keys.length ? sales![keys.at(-1)!] : null;
}

export const hasSalesOf = (sales: Record<string, SalesSnapshot> | undefined, kind: PeriodKind) => keysOf(sales, kind).length > 0;
