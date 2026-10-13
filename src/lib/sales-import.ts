/**
 * Reads sales figures from a CSV. Two layouts:
 *  - summary: one row per status with units, value and size (percentage columns and a Total row are ignored);
 *  - register: one row per unit with its status (and value / size), counted and added up per status.
 */
import Papa from "papaparse";
import type { SalesRow } from "@/db/types";

export interface SalesParse { rows: SalesRow[]; errors: string[]; info: string[]; layout: "summary" | "register" | null }

const norm = (h: string) => h.trim().toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const isPct = (v: string) => /%\s*$/.test(v.trim());
function num(v: string | undefined): number | null {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || isPct(s) || /^[-–—]$/.test(s)) return null;
  s = s.replace(/m\s*(2|²)/gi, "").replace(/^r\s*/i, "").replace(/[\s\u00a0]/g, "");
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot > -1 && lastComma > -1) s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lastComma > -1) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const STATUS = ["status", "unit_status", "sales_status", "availability", "state"];
const UNITS = ["units", "unit_count", "count", "number_of_units", "no_of_units", "qty", "quantity"];
const VALUE = ["value", "price", "total_value", "value_zar", "selling_price", "list_price", "amount"];
const SIZE = ["size", "size_m2", "area", "m2", "sqm", "floor_area"];

export function parseSalesCsv(text: string): SalesParse {
  const errors: string[] = [], info: string[] = [];
  const grid = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" }).data.map((r) => r.map((c) => (c ?? "").trim()));
  if (!grid.length) return { rows: [], errors: ["The file is empty."], info, layout: null };

  // Find the heading row: the first row naming a status column, or a units / value / size column.
  const hIdx = grid.findIndex((r) => r.some((c) => STATUS.includes(norm(c))) || r.filter((c) => [...UNITS, ...VALUE, ...SIZE].includes(norm(c))).length >= 2);
  const head = hIdx >= 0 ? grid[hIdx].map(norm) : [];
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const statusCol = col(STATUS), unitsCol = col(UNITS), valueCol = col(VALUE), sizeCol = col(SIZE);
  const body = grid.slice(hIdx + 1);

  // Register: a status column and no units column, with more rows than statuses.
  if (statusCol >= 0 && unitsCol < 0) {
    const by = new Map<string, SalesRow>();
    for (const r of body) {
      const st = r[statusCol];
      if (!st || /^total/i.test(st)) continue;
      const key = st.charAt(0).toUpperCase() + st.slice(1).toLowerCase();
      const cur = by.get(key) ?? { status: key, units: 0, value: null, size: null };
      cur.units += 1;
      const v = valueCol >= 0 ? num(r[valueCol]) : null;
      const sz = sizeCol >= 0 ? num(r[sizeCol]) : null;
      if (v != null) cur.value = (cur.value ?? 0) + v;
      if (sz != null) cur.size = (cur.size ?? 0) + sz;
      by.set(key, cur);
    }
    const rows = [...by.values()];
    if (!rows.length) errors.push("No units with a status were found.");
    else info.push(`Read a unit list: counted ${rows.reduce((t, r) => t + r.units, 0)} units across ${rows.length} statuses.`);
    return { rows, errors, info, layout: "register" };
  }

  // Summary: first cell is the status; numbers come from named columns, or in order (units, value, size) skipping percentages.
  const rows: SalesRow[] = [];
  for (const r of body) {
    const st = (statusCol >= 0 ? r[statusCol] : r[0]) ?? "";
    if (!st || /^total/i.test(st) || num(st) != null) continue;
    let units: number | null, value: number | null, size: number | null;
    if (unitsCol >= 0) {
      units = num(r[unitsCol]); value = valueCol >= 0 ? num(r[valueCol]) : null; size = sizeCol >= 0 ? num(r[sizeCol]) : null;
    } else {
      const nums = r.slice(1).filter((c) => !isPct(c)).map(num).filter((n): n is number => n != null);
      [units, value, size] = [nums[0] ?? null, nums[1] ?? null, nums[2] ?? null];
    }
    if (units == null) continue;
    rows.push({ status: st.slice(0, 40), units: Math.round(units), value, size });
  }
  if (!rows.length) errors.push("Couldn’t find any statuses with unit numbers. Use the sales template: status, units, value, size.");
  else info.push(`Read ${rows.length} statuses.`);
  if (new Set(rows.map((r) => r.status.toLowerCase())).size !== rows.length) errors.push("A status appears more than once. Each status should have one row.");
  return { rows, errors, info, layout: "summary" };
}

export const SALES_TEMPLATE = `status,units,value,size
Available,,,
Reserved,,,
Sold,,,
Granted,,,
Bankable,,,
`;
