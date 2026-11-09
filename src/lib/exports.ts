/**
 * CSV exports of stored figures, in the same layouts the importer reads, so an export can be
 * uploaded again unchanged. Used when the original file wasn't kept (uploads from before files were kept).
 */
import { BASE_METRICS as METRICS } from "./metrics";
import { roomRates, type RoomSnapshot } from "./room-sales";
import type { MonthDoc, SalesSnapshot } from "@/db/types";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells: unknown[]) => cells.map(cell).join(",");
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** One month or week: one row per channel, one column per stored figure (calculated figures are left out). */
export function periodCsv(period: string, m: MonthDoc): string {
  const keys = new Set(m.channels.flatMap((c) => Object.keys(c.metrics)));
  const ordered = [...METRICS.map((x) => x.key).filter((k) => keys.has(k)), ...[...keys].filter((k) => !METRICS.some((x) => x.key === k)).sort()];
  const cols = ordered.filter((k) => k !== "result_spend"); // internal working figure, worked out again on import
  return [line(["month", "channel", ...cols]), ...m.channels.map((c) => line([period, c.channel, ...cols.map((k) => c.metrics[k] ?? "")]))].join("\n") + "\n";
}

export function salesCsv(s: SalesSnapshot): string {
  return [line(["status", "units", "value", "size"]), ...s.rows.map((r) => line([r.status, r.units, r.value ?? "", r.size ?? ""]))].join("\n") + "\n";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const r0 = (n: number) => String(Math.round(n));

/** A room sales report in the hotel's daily dashboard layout. */
export function roomsCsv(s: RoomSnapshot): string {
  const out = [line([s.title || "ROOM SALES"]), line(["Reporting date", s.reportDate, "", "Forecast horizon", s.horizon || ""])];
  const forecast = s.months.filter((x) => !x.fromDays);
  const withBudget = forecast.some((m) => m.budget != null);
  out.push(line(["Month", "Rooms Available", "OTB Rooms", "OTB Occ.", "OTB Revenue", "OTB ADR", "OTB RevPAR", ...(withBudget ? ["Budget Revenue"] : []), "Key Demand Driver", "Commercial Priority", "Rate Strategy", "Sales / Marketing Action"]));
  for (const m of forecast) {
    const x = roomRates(m);
    out.push(line([`${MONTHS[+m.month.slice(5, 7) - 1]} ${m.month.slice(0, 4)}`, m.available, m.otb, pct(x.occ), round(m.revenue), r0(x.adr), r0(x.revpar), ...(withBudget ? [m.budget ?? ""] : []), m.driver ?? "", m.priority ?? "", m.rate ?? "", m.action ?? ""]));
  }
  out.push("", line(["DAILY OTB DETAIL"]));
  out.push(line(["Date", "Day", "Rooms Available", "OTB Rooms", "OTB Occ.", "OTB Revenue", "ADR", "RevPAR", "Value Focus", "Rate Action", "Sales Action"]));
  for (const d of s.days) {
    const x = roomRates(d);
    const dt = new Date(`${d.date}T12:00:00Z`);
    out.push(line([`${d.date.slice(8)}-${SHORT[dt.getUTCMonth()]}-${d.date.slice(0, 4)}`, DAYS[dt.getUTCDay()], d.available, d.otb, pct(x.occ), round(d.revenue), r0(x.adr), r0(x.revpar), d.focus ?? "", d.rateAction ?? "", d.salesAction ?? ""]));
  }
  return out.join("\n") + "\n";
}

/** A safe download file name. */
export const safeName = (s: string) => s.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(0, 120) || "download";
