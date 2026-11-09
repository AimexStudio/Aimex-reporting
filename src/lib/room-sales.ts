/**
 * Hotel room sales ("on the books") report, e.g. a daily dashboard CSV from the hotel's
 * revenue sheet: a reporting date, a monthly forecast table and a daily OTB table.
 * Pure: safe on server and client.
 */
import Papa from "papaparse";

export interface RoomMonth {
  month: string; // "YYYY-MM"
  /** true when the file has no monthly row for it and it was added up from the daily rows */
  fromDays?: boolean;
  available: number;
  otb: number;
  revenue: number;
  /** The month's revenue budget, from an optional budget column in the file */
  budget?: number;
  driver?: string;
  priority?: string;
  rate?: string;
  action?: string;
}
export interface RoomDay {
  date: string; // "YYYY-MM-DD"
  available: number;
  otb: number;
  revenue: number;
  focus?: string;
  rateAction?: string;
  salesAction?: string;
}
export interface RoomSnapshot {
  reportDate: string; // "YYYY-MM-DD"
  title?: string | null;
  horizon?: string | null;
  months: RoomMonth[];
  days: RoomDay[];
  filename?: string | null;
  /** Comments shown with this report. */
  comment?: string | null;
  updatedAt?: number;
}
export interface RoomParse { snapshot: RoomSnapshot | null; errors: string[]; warnings: string[]; info: string[] }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
function num(v?: string): number | null {
  if (v == null) return null;
  const s = v.replace(/^r\s*/i, "").replace(/[\s,\u00a0]/g, "").replace(/%$/, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}
const pad = (n: number) => String(n).padStart(2, "0");
const mon = (s: string) => MONTHS[s.slice(0, 3).toLowerCase()];
function day(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{4})$/);
  if (m && mon(m[2])) return `${m[3]}-${pad(mon(m[2]))}-${pad(+m[1])}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : null;
}
function month(v: string): string | null {
  const m = v.trim().match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m && mon(m[1])) return `${m[2]}-${pad(mon(m[1]))}`;
  return /^\d{4}-\d{2}$/.test(v.trim()) ? v.trim() : null;
}

export function isRoomSalesCsv(text: string): boolean {
  const head = text.slice(0, 4000).toLowerCase();
  return /otb rooms/.test(head) && /rooms available/.test(head);
}

export function parseRoomSales(text: string): RoomParse {
  const errors: string[] = [], warnings: string[] = [], info: string[] = [];
  const grid = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: false }).data.map((r) => r.map((c) => (c ?? "").trim()));
  const blank = (r: string[]) => r.every((c) => !c);

  const title = grid[0]?.[0] && !grid[0].slice(1).some(Boolean) ? grid[0][0] : null;
  let reportDate: string | null = null;
  let horizon: string | null = null;
  for (const r of grid.slice(0, 10)) {
    r.forEach((c, i) => {
      if (/^reporting date$/i.test(c) && r[i + 1]) reportDate = day(r[i + 1]);
      if (/^forecast horizon$/i.test(c) && r[i + 1]) horizon = r[i + 1];
    });
  }

  // A table = a heading row, then rows until a blank row.
  const table = (test: (h: string[]) => boolean) => {
    const at = grid.findIndex((r) => test(r.map(norm)));
    if (at < 0) return null;
    const head = grid[at].map(norm);
    const rows: string[][] = [];
    for (let i = at + 1; i < grid.length && !blank(grid[i]); i++) rows.push(grid[i]);
    return { rows, col: (...names: string[]) => head.findIndex((h) => names.includes(h)) };
  };

  const months: RoomMonth[] = [];
  const mt = table((h) => h[0] === "month" && h.includes("rooms_available"));
  if (mt) {
    const adrCol = mt.col("otb_adr", "adr");
    const budgetCol = mt.col("budget", "budget_revenue", "revenue_budget", "monthly_budget", "room_revenue_budget", "budgeted_revenue", "revenue_target", "target_revenue", "target");
    const c = { a: mt.col("rooms_available"), o: mt.col("otb_rooms"), r: mt.col("otb_revenue", "revenue"),
      d: mt.col("key_demand_driver", "demand_driver"), p: mt.col("commercial_priority", "priority"), s: mt.col("rate_strategy"), x: mt.col("sales_marketing_action", "sales_action") };
    for (const r of mt.rows) {
      const m = month(r[0] ?? ""), a = num(r[c.a]), o = num(r[c.o]), rev = num(r[c.r]);
      if (!m || a == null || o == null) continue;
      // The file's own ADR should equal revenue ÷ rooms; flag a sheet whose figures disagree.
      const fileAdr = adrCol >= 0 ? num(r[adrCol]) : null;
      if (fileAdr && rev && o && Math.abs(rev / o - fileAdr) / fileAdr > 0.02) {
        warnings.push(`${label(m)}: the file's ADR (R ${fmt(fileAdr)}) doesn't match its revenue ÷ rooms (R ${fmt(rev)} ÷ ${o} = R ${fmt(rev / o)}). The report works ADR out from rooms and revenue.`);
      }
      const budget = budgetCol >= 0 ? num(r[budgetCol]) : null;
      months.push({ month: m, available: a, otb: o, revenue: rev ?? 0, ...(budget != null && budget > 0 ? { budget } : {}),
        ...(r[c.d] ? { driver: r[c.d] } : {}), ...(r[c.p] ? { priority: r[c.p] } : {}), ...(r[c.s] ? { rate: r[c.s] } : {}), ...(r[c.x] ? { action: r[c.x] } : {}) });
    }
  }

  const days: RoomDay[] = [];
  const dt = table((h) => h[0] === "date" && h.includes("rooms_available"));
  if (dt) {
    const c = { a: dt.col("rooms_available"), o: dt.col("otb_rooms"), r: dt.col("otb_revenue", "revenue"),
      f: dt.col("value_focus", "focus"), ra: dt.col("rate_action"), sa: dt.col("sales_action") };
    for (const r of dt.rows) {
      const d = day(r[0] ?? ""), a = num(r[c.a]), o = num(r[c.o]), rev = num(r[c.r]);
      if (!d || a == null || o == null) continue;
      days.push({ date: d, available: a, otb: o, revenue: rev ?? 0,
        ...(r[c.f] ? { focus: r[c.f] } : {}), ...(r[c.ra] ? { rateAction: r[c.ra] } : {}), ...(r[c.sa] ? { salesAction: r[c.sa] } : {}) });
    }
  }

  if (!months.length && !days.length) errors.push("Couldn’t find a monthly forecast or daily table with Rooms Available and OTB Rooms columns.");
  if (!reportDate) errors.push("Couldn’t find the reporting date (a “Reporting date” cell near the top of the file).");
  // Months that only appear in the daily table are added up from their days.
  const fromDays = new Map<string, RoomMonth>();
  for (const d of days) {
    const k = d.date.slice(0, 7);
    if (months.some((m) => m.month === k)) continue;
    const cur = fromDays.get(k) ?? { month: k, fromDays: true, available: 0, otb: 0, revenue: 0 };
    cur.available += d.available; cur.otb += d.otb; cur.revenue += d.revenue;
    fromDays.set(k, cur);
  }
  // A daily table with different rooms available per month belongs to another sheet (e.g. another hotel's).
  for (const m of months) {
    const ds = days.filter((d) => d.date.startsWith(m.month));
    const inMonth = new Date(Date.UTC(+m.month.slice(0, 4), +m.month.slice(5, 7), 0)).getUTCDate();
    const avail = ds.reduce((t, d) => t + d.available, 0);
    if (ds.length === inMonth && Math.abs(avail - m.available) > Math.max(2, m.available * 0.02)) {
      warnings.unshift(`The daily table doesn’t match the monthly figures: ${label(m.month)} has ${m.available} rooms available in the monthly rows but ${avail} in the daily rows (${Math.round(avail / inMonth)} a night). It may be another hotel’s data, so the report leaves the daily chart out. Check the daily sheet.`);
      break;
    }
  }
  // A month fully covered by daily rows should add up to its monthly row.
  for (const m of months) {
    const ds = days.filter((d) => d.date.startsWith(m.month));
    const inMonth = new Date(Date.UTC(+m.month.slice(0, 4), +m.month.slice(5, 7), 0)).getUTCDate();
    if (ds.length !== inMonth) continue;
    const otb = ds.reduce((t, d) => t + d.otb, 0), rev = ds.reduce((t, d) => t + d.revenue, 0);
    if (Math.abs(otb - m.otb) > 1 || Math.abs(rev - m.revenue) > Math.max(50, m.revenue * 0.005)) {
      warnings.push(`${label(m.month)}: the monthly row (${m.otb} rooms, R ${fmt(m.revenue)}) doesn't match the daily rows (${otb} rooms, R ${fmt(rev)}). The report shows the monthly row; check the sheet.`);
    }
  }
  const budgets = months.filter((m) => m.budget != null).length;
  if (!errors.length && budgets) info.push(`Budgets read for ${budgets} of ${months.length} months.`);
  if (!errors.length) info.push(`Read ${months.length} forecast month${months.length === 1 ? "" : "s"} and ${days.length} days, as at ${reportDate}.`);
  return {
    snapshot: errors.length ? null : {
      reportDate: reportDate!, title, horizon,
      months: [...months, ...fromDays.values()].sort((a, b) => a.month.localeCompare(b.month)),
      days: days.sort((a, b) => a.date.localeCompare(b.date)),
    },
    errors, warnings, info,
  };
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (m: string) => `${MONTH_NAMES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

/** Occupancy, ADR and RevPAR worked out from rooms and revenue, so they always agree. */
export function roomRates(x: { available: number; otb: number; revenue: number }) {
  return { occ: x.available ? x.otb / x.available : 0, adr: x.otb ? x.revenue / x.otb : 0, revpar: x.available ? x.revenue / x.available : 0 };
}

export function focusColor(focus?: string): string {
  const f = (focus ?? "").toUpperCase();
  if (f.startsWith("GREEN")) return "#2E8B3A";
  if (f.startsWith("AMBER")) return "#C99700";
  if (f.startsWith("RED")) return "#D6312B";
  return "#8A94A6";
}

/* ================= weekly outlook: each month on its own, with pace and projection ================= */

const DAY_MS = 864e5;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const monthEnd = (m: string) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0);
/** The morning after the month's last night: nights from the reporting date up to here are still to come. */
const afterLastNight = (m: string) => Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1);

export interface MonthOutlook {
  month: string;
  available: number; otb: number; revenue: number;
  occ: number; adr: number; revpar: number;
  /** rooms available each night (the hotel's keys): rooms available ÷ nights in the month */
  keys: number;
  /** the month's revenue budget, when the file has one */
  budget: number | null;
  /** rooms gained since the previous upload (null without one) */
  pickup: number | null; pickupRevenue: number | null; previousDate: string | null;
  /** rooms gained per week, over up to the last four weeks of uploads (null with fewer than two uploads) */
  pace: number | null;
  /** weeks from the reporting date to the end of the month's last night */
  weeksLeft: number;
  /** month-end rooms at the current pace, capped at the rooms available */
  projectedRooms: number | null; projectedOcc: number | null; projectedRevenue: number | null;
  priority?: string; rate?: string; action?: string; driver?: string;
}

/** The daily table belongs with the monthly figures (same rooms available) — otherwise it's someone else's data. */
export function dailyMatches(s: RoomSnapshot): boolean {
  if (!s.days.length) return false;
  for (const m of s.months.filter((x) => !x.fromDays)) {
    const ds = s.days.filter((d) => d.date.startsWith(m.month));
    const inMonth = new Date(monthEnd(m.month)).getUTCDate();
    if (ds.length === inMonth && Math.abs(ds.reduce((t, d) => t + d.available, 0) - m.available) > Math.max(2, m.available * 0.02)) return false;
  }
  return true;
}

/**
 * Each forecast month of one report on its own: where it stands, how it moved since the last upload,
 * its weekly booking pace and a month-end projection at that pace. Never added together across months.
 */
export function roomOutlook(all: Record<string, RoomSnapshot>, at: string): { current: MonthOutlook | null; ahead: MonthOutlook[]; earlier: MonthOutlook[] } {
  const snap = all[at];
  const dates = Object.keys(all).sort().filter((d) => d <= at);
  const prevDate = dates.filter((d) => d < at).at(-1) ?? null;
  const reportMs = dayMs(at);
  const rowOf = (s: RoomSnapshot | undefined, m: string) => s?.months.find((x) => x.month === m && !x.fromDays);

  const list = snap.months.filter((m) => !m.fromDays).map((m): MonthOutlook => {
    const r = roomRates(m);
    const prev = prevDate ? rowOf(all[prevDate], m.month) : undefined;
    // pace: from the earliest upload within the last 28 days that has this month, to this one
    const base = dates.filter((d) => d < at && reportMs - dayMs(d) <= 28 * DAY_MS && rowOf(all[d], m.month))[0];
    const baseRow = base ? rowOf(all[base], m.month)! : undefined;
    const weeksSpan = base ? (reportMs - dayMs(base)) / (7 * DAY_MS) : 0;
    const pace = baseRow && weeksSpan > 0 ? (m.otb - baseRow.otb) / weeksSpan : null;
    const weeksLeft = Math.max(0, (afterLastNight(m.month) - reportMs) / (7 * DAY_MS));
    const projectedRooms = pace == null ? null : Math.round(Math.min(m.available, Math.max(0, m.otb + pace * weeksLeft)));
    return {
      month: m.month, available: m.available, otb: m.otb, revenue: m.revenue, occ: r.occ, adr: r.adr, revpar: r.revpar,
      keys: Math.round(m.available / new Date(monthEnd(m.month)).getUTCDate()), budget: m.budget ?? null,
      pickup: prev ? m.otb - prev.otb : null, pickupRevenue: prev ? m.revenue - prev.revenue : null, previousDate: prev ? prevDate : null,
      pace, weeksLeft, projectedRooms,
      projectedOcc: projectedRooms == null || !m.available ? null : projectedRooms / m.available,
      projectedRevenue: projectedRooms == null ? null : projectedRooms * r.adr,
      priority: m.priority, rate: m.rate, action: m.action, driver: m.driver,
    };
  });
  const thisMonth = at.slice(0, 7);
  return {
    current: list.find((m) => m.month === thisMonth) ?? null,
    ahead: list.filter((m) => m.month > thisMonth),
    earlier: list.filter((m) => m.month < thisMonth),
  };
}

/** How each month's occupancy on the books built up across uploads: one series per month. */
export function paceSeries(all: Record<string, RoomSnapshot>, at: string, max = 12) {
  const dates = Object.keys(all).sort().filter((d) => d <= at).slice(-max);
  const months = all[at].months.filter((m) => !m.fromDays).map((m) => m.month);
  return {
    months,
    points: dates.map((d) => ({
      date: d,
      ...Object.fromEntries(months.map((m) => {
        const row = all[d].months.find((x) => x.month === m && !x.fromDays);
        return [m, row && row.available ? Math.round(row.otb / row.available * 1000) / 10 : null];
      })),
    })),
  };
}

/* ================= week by week ahead (from the daily rows) ================= */

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** The Monday of the week an ISO date falls in. */
export const mondayOf = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

export interface WeekAhead {
  week: string; // Monday "YYYY-MM-DD"
  nights: number; otb: number; available: number; revenue: number; occ: number;
  /** the same nights in the previous upload, when it has matching daily rows */
  prevOtb: number | null; prevOcc: number | null; pickup: number | null;
}

/**
 * Occupancy on the books for each week from the reporting date onwards (Monday to Sunday),
 * compared night for night with the previous upload when there is one.
 */
export function weeksAhead(all: Record<string, RoomSnapshot>, at: string): { weeks: WeekAhead[]; previousDate: string | null } {
  const snap = all[at];
  if (!snap || !dailyMatches(snap)) return { weeks: [], previousDate: null };
  const prevDate = Object.keys(all).sort().filter((d) => d < at && dailyMatches(all[d])).at(-1) ?? null;
  const prevDays = new Map((prevDate ? all[prevDate].days : []).map((d) => [d.date, d]));
  const by = new Map<string, WeekAhead>();
  for (const d of snap.days.filter((x) => x.date >= at)) {
    const k = mondayOf(d.date);
    const w = by.get(k) ?? { week: k, nights: 0, otb: 0, available: 0, revenue: 0, occ: 0, prevOtb: prevDate ? 0 : null, prevOcc: null, pickup: null };
    w.nights++; w.otb += d.otb; w.available += d.available; w.revenue += d.revenue;
    if (w.prevOtb != null) { const p = prevDays.get(d.date); if (p) w.prevOtb += p.otb; else w.prevOtb = null; }
    by.set(k, w);
  }
  const weeks = [...by.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({
    ...w,
    occ: w.available ? w.otb / w.available : 0,
    prevOcc: w.prevOtb != null && w.available ? w.prevOtb / w.available : null,
    pickup: w.prevOtb != null ? w.otb - w.prevOtb : null,
  }));
  return { weeks, previousDate: prevDate };
}

/* ================= this month: stayed so far vs booked ahead ================= */

export interface MonthSplit {
  /** nights before the reporting date (already stayed) */
  stayedRooms: number; stayedRevenue: number; stayedFrom: string; stayedTo: string | null;
  /** nights from the reporting date to the month end (booked, not yet stayed) */
  aheadRooms: number; aheadRevenue: number; aheadFrom: string; aheadTo: string;
}

/**
 * Splits the reporting month into what's already been stayed and what's booked but not yet stayed.
 * Booked = the daily rows from the reporting date to the month end. Stayed = the daily rows before the reporting date
 * when the file has every one of them, otherwise the month total minus booked.
 * Needs a daily row for every night from the reporting date to the month end, and daily rows that belong
 * with the monthly figures; otherwise null (the month can't be split).
 */
export function monthSplit(s: RoomSnapshot): MonthSplit | null {
  const m = s.reportDate.slice(0, 7);
  const row = s.months.find((x) => x.month === m && !x.fromDays);
  if (!row || !dailyMatches(s)) return null;
  const end = new Date(monthEnd(m)).toISOString().slice(0, 10);
  const ahead = s.days.filter((d) => d.date >= s.reportDate && d.date <= end);
  const nights = Math.round((Date.parse(end) - Date.parse(s.reportDate)) / DAY_MS) + 1;
  if (ahead.length !== nights) return null;
  const aheadRooms = ahead.reduce((t, d) => t + d.otb, 0), aheadRevenue = ahead.reduce((t, d) => t + d.revenue, 0);
  const first = `${m}-01`;
  // Nights already stayed: add them up from the daily rows when the file has them all; otherwise month total minus booked.
  const before = s.days.filter((d) => d.date >= first && d.date < s.reportDate);
  const stayedNights = Math.round((Date.parse(s.reportDate) - Date.parse(first)) / DAY_MS);
  const fromDaily = stayedNights > 0 && before.length === stayedNights;
  return {
    stayedRooms: fromDaily ? before.reduce((t, d) => t + d.otb, 0) : Math.max(0, row.otb - aheadRooms),
    stayedRevenue: fromDaily ? before.reduce((t, d) => t + d.revenue, 0) : Math.max(0, row.revenue - aheadRevenue),
    stayedFrom: first, stayedTo: s.reportDate > first ? addDays(s.reportDate, -1) : null,
    aheadRooms, aheadRevenue, aheadFrom: s.reportDate, aheadTo: end,
  };
}
