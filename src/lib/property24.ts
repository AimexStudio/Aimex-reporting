/**
 * Property24 "Agency Statistics" report (PDF), after its text has been extracted:
 * one line per table row, cells separated by tabs. Each section is a title line
 * ("Listing Views"), a month header line and a value line.
 */
import type { ParseResult, ParsedRow } from "./csv";
import { isMonth, monthLabel } from "./metrics";

export const PDF_TEXT_MARK = "%%PDF-TEXT%%";

export function isProperty24(text: string): boolean {
  return text.startsWith(PDF_TEXT_MARK) && /Agency Statistics/i.test(text) && /Listing (Views|Leads)/i.test(text);
}

const SECTIONS: [RegExp, string][] = [
  [/^listing views$/i, "listing_views"],
  [/^listing leads$/i, "leads"],
  [/^listing counts$/i, "active_listings"],
  [/^alert emails$/i, "alert_emails"],
  [/^alerted listings$/i, "alerted_listings"],
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (cell: string) => {
  const m = cell.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*$/);
  return m ? MONTHS.indexOf(m[1]) + 1 : 0;
};
const num = (v: string) => { const t = v.replace(/[\s\u00a0]/g, ""); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };

export function parseProperty24(text: string, formMonth?: string, defaultChannel?: string, today = new Date()): ParseResult {
  const warnings: string[] = [];
  const info: string[] = [];
  const errors: string[] = [];
  const channel = defaultChannel?.trim() && !/meta|google|website/i.test(defaultChannel) ? defaultChannel.trim() : "Property24";
  const lines = text.slice(PDF_TEXT_MARK.length).split("\n").map((l) => l.split("\t").map((c) => c.trim()).filter(Boolean)).filter((l) => l.length);

  const agency = lines.find((l, i) => i > 0 && lines[i - 1][0] === "Agency Statistics")?.[0];
  const series = new Map<string, { months: number[]; partial: boolean[]; values: (number | null)[] }>();
  let missingMarket = false;
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].join(" ");
    if (/market share/i.test(title)) missingMarket = true;
    const sec = SECTIONS.find(([re]) => re.test(title));
    if (!sec || series.has(sec[1])) continue;
    // next line with month names, then the next line with numbers
    const head = lines.slice(i + 1, i + 4).find((l) => l.filter((c) => monthIndex(c)).length >= 2);
    if (!head) continue;
    const hi = lines.indexOf(head, i + 1);
    const valuesLine = lines[hi + 1];
    if (!valuesLine) continue;
    const cells = valuesLine.length === head.length + 1 ? valuesLine.slice(1) : valuesLine; // e.g. "Average" label
    series.set(sec[1], {
      months: head.map(monthIndex),
      partial: head.map((c) => /\d+(st|nd|rd|th)?\s*-\s*\d+/.test(c)),
      values: cells.map((c) => (c === "-" ? null : num(c))),
    });
  }
  if (!series.size) {
    errors.push("Couldn’t find the Listing Views or Listing Leads tables in this Property24 report.");
    return empty(errors, warnings, info);
  }

  // The report doesn't print a year. Its last month is taken to be the most recent such month up to today.
  const anyS = [...series.values()][0];
  const lastM = anyS.months.at(-1)!;
  const nowY = today.getFullYear(), nowM = today.getMonth() + 1;
  let year = lastM <= nowM ? nowY : nowY - 1;
  const ym: string[] = [];
  for (let k = anyS.months.length - 1; k >= 0; k--) {
    const m = anyS.months[k];
    if (k < anyS.months.length - 1 && m > anyS.months[k + 1]) year--; // crossed back over January
    ym[k] = `${year}-${String(m).padStart(2, "0")}`;
  }

  const rows: ParsedRow[] = [];
  for (const [metric, s] of series) {
    s.values.forEach((v, k) => { if (v != null && ym[k] && isMonth(ym[k])) rows.push({ month: ym[k], channel, metric, value: v }); });
  }
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const partialIdx = anyS.partial.findIndex(Boolean);
  const partialMonths: Record<string, string> = {};
  if (partialIdx >= 0 && ym[partialIdx]) {
    const raw = lines.flatMap((l) => l).find((c) => /\d+\s*(st|nd|rd|th)?\s*-\s*\d+/.test(c)) ?? "part of the month";
    partialMonths[ym[partialIdx]] = raw.replace(/\s*(oct|october|nov|november|dec|december|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september)\w*\s*$/i, "").trim() + ` ${monthLabel(ym[partialIdx]).split(" ")[0]}`;
  }
  if (partialIdx >= 0) {
    warnings.push(`${monthLabel(ym[partialIdx])} is only partly covered (${lines.find((l) => l.some((c) => /\d+(st|nd|rd|th)?\s*-\s*\d+/.test(c)))?.find((c) => /\d+\s*(st|nd|rd|th)?\s*-/.test(c)) ?? "part of the month"}). It’s saved as month-to-date and replaced when you upload a later report.`);
  }
  info.push(`Property24 report${agency ? ` for ${agency}` : ""}: read ${[...series.keys()].length} tables covering ${monthLabel(months[0])} to ${monthLabel(months.at(-1)!)}, saved under “${channel}”.`);
  info.push(`The report doesn’t show a year, so these were read as ${months[0].slice(0, 4) === months.at(-1)!.slice(0, 4) ? months[0].slice(0, 4) : `${months[0].slice(0, 4)}–${months.at(-1)!.slice(0, 4)}`}, the most recent ${monthLabel(months.at(-1)!).split(" ")[0]} up to today.`);
  if (missingMarket) info.push("Listing market share and the leads split by type are only shown as charts in the PDF, so they can’t be imported.");
  if (formMonth && !months.includes(formMonth)) { /* the form month isn't used: the report names its own months */ }

  return {
    rows, breakdowns: {}, hasConversions: false, hasChannelColumn: false, partialMonths,
    months, channels: [channel], metrics: [...new Set(rows.map((r) => r.metric))],
    warnings, info, errors, detectedSource: "Property24", sourceRows: rows.length,
  };
}

function empty(errors: string[], warnings: string[], info: string[]): ParseResult {
  return { rows: [], breakdowns: {}, hasConversions: false, months: [], channels: [], metrics: [], warnings, info, errors, detectedSource: "Property24", sourceRows: 0 };
}
