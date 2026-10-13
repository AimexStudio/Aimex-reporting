/**
 * Reporting periods. Monthly ids are "YYYY-MM"; weekly ids are ISO weeks "YYYY-Www"
 * (Monday to Sunday). Pure: safe on server and client.
 */
export type PeriodKind = "month" | "week";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const isWeekId = (s: string) => /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(s);
export const isMonthId = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isPeriodId = (s: string) => isMonthId(s) || isWeekId(s);
export const kindOf = (id: string): PeriodKind => (isWeekId(id) ? "week" : "month");

/** ISO week id for a date (local calendar date, no time zone surprises). */
export function weekOf(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

export function weekOfDate(d: Date): string {
  return weekOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Monday and Sunday (UTC dates) of an ISO week. */
export function weekRange(id: string): { start: Date; end: Date } {
  const [y, w] = [Number(id.slice(0, 4)), Number(id.slice(6))];
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday, end: sunday };
}

const dm = (d: Date, withMonth = true, withYear = false) =>
  `${d.getUTCDate()}${withMonth ? ` ${MONTHS[d.getUTCMonth()]}` : ""}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;

/** "5 – 11 October 2026", or "28 September – 4 October 2026" across months. */
export function weekSpan(id: string): string {
  const { start, end } = weekRange(id);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  return `${dm(start, !sameMonth, !sameYear)} – ${dm(end, true, true)}`;
}

/** Labels: long "Week 41: 5 – 11 October 2026"; short "5 Oct". */
export function weekLabel(id: string, style: "long" | "short" = "long"): string {
  if (style === "short") {
    const { start } = weekRange(id);
    return `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()].slice(0, 3)}`;
  }
  return `Week ${Number(id.slice(6))}: ${weekSpan(id)}`;
}

/** How a period is named in a sentence: "September" or "The week of 5 October". */
export function periodName(id: string, capital = true): string {
  if (!isWeekId(id)) return MONTHS[Number(id.slice(5, 7)) - 1] ?? id;
  const { start } = weekRange(id);
  return `${capital ? "The" : "the"} week of ${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`;
}

/** The month a week mostly falls in (its Thursday), e.g. for monthly sales figures. */
export function monthOfPeriod(id: string): string {
  if (!isWeekId(id)) return id;
  const { start } = weekRange(id);
  const thu = new Date(start);
  thu.setUTCDate(start.getUTCDate() + 3);
  return `${thu.getUTCFullYear()}-${String(thu.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last complete period before today. */
export function previousPeriod(kind: PeriodKind, today = new Date()): string {
  if (kind === "week") {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return weekOfDate(d);
  }
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Words that change with the period. */
export function words(kind: PeriodKind) {
  return kind === "week"
    ? { unit: "week", Unit: "Week", last: "last week", next: "next week", byUnit: "Week by", perUnit: "per week", short: "/wk", each: "each week", unitly: "Weekly" }
    : { unit: "month", Unit: "Month", last: "last month", next: "next month", byUnit: "Month by", perUnit: "per month", short: "/mo", each: "each month", unitly: "Monthly" };
}
