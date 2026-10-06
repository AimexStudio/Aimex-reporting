/**
 * Google Analytics 4 "Reports snapshot" CSV: several small tables, each introduced by
 * "#" comment lines with a start and end date (YYYYMMDD), separated by blank lines.
 */
import Papa from "papaparse";
import type { Breakdowns } from "@/db/types";
import { isMonth, monthLabel } from "./metrics";
import type { ParseResult, ParsedRow } from "./csv";

export function isGa4Snapshot(text: string): boolean {
  const head = text.slice(0, 2000);
  return /^#\s*Reports snapshot/im.test(head) || (/^#\s*Start date:\s*\d{8}/im.test(head) && /^#\s*(Account|Property):/im.test(head));
}

interface Table { start?: string; end?: string; header: string[]; rows: string[][] }

function tables(text: string): Table[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const out: Table[] = [];
  let start: string | undefined, end: string | undefined;
  let cur: Table | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { cur = null; continue; }
    if (line.startsWith("#")) {
      cur = null;
      const s = line.match(/Start date:\s*(\d{8})/i); if (s) start = s[1];
      const e = line.match(/End date:\s*(\d{8})/i); if (e) end = e[1];
      continue;
    }
    const cells = Papa.parse<string[]>(line).data[0] ?? [];
    if (!cur) { cur = { start, end, header: cells.map((c) => c.trim()), rows: [] }; out.push(cur); }
    else cur.rows.push(cells.map((c) => c.trim()));
  }
  return out;
}

const ym = (d?: string) => (d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}` : null);
const num = (v?: string) => { const n = Number(String(v ?? "").replace(/[^\d.\-]/g, "")); return v && Number.isFinite(n) ? n : null; };
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const SUMMARY: Record<string, string> = {
  active_users: "users", total_users: "users", users: "users", new_users: "new_users", sessions: "sessions",
  average_engagement_time_per_active_user: "avg_engagement_time", average_engagement_time: "avg_engagement_time",
  key_events: "key_events", conversions: "key_events", total_revenue: "revenue", engaged_sessions: "engaged_sessions",
};

export function parseGa4Snapshot(text: string, formMonth?: string, defaultChannel?: string): ParseResult {
  const warnings: string[] = [];
  const info: string[] = [];
  const errors: string[] = [];
  const ts = tables(text);
  const channel = defaultChannel?.trim() && !/google ads|meta/i.test(defaultChannel) ? defaultChannel.trim() : "Website";

  const first = ts.find((t) => t.start);
  const sm = ym(first?.start), em = ym(first?.end);
  let month = sm && isMonth(sm) ? sm : formMonth;
  if (sm && em && sm !== em) warnings.push(`This report covers ${monthLabel(sm)} to ${monthLabel(em)}. Its figures are saved under ${monthLabel(sm)}. Export one calendar month at a time for exact monthly figures.`);
  if (!month) { errors.push("The report has no start date. Pick the month in the upload form."); month = ""; }
  if (sm && formMonth && sm !== formMonth) info.push(`Used ${monthLabel(sm)} from the report’s dates rather than the month picked in the form.`);

  const metrics: Record<string, number> = {};
  const breakdowns: Breakdowns = {};
  const seen = new Set<string>();
  let used = 0;

  for (const t of ts) {
    const h = t.header.map(norm);
    const sig = JSON.stringify([h, t.rows]);
    if (seen.has(sig)) continue; // GA4 repeats some tables
    seen.add(sig);
    const allNumeric = (r: string[]) => r.every((c) => num(c) != null);
    if (t.rows.length === 1 && allNumeric(t.rows[0]) && h.some((k) => SUMMARY[k])) {
      // the overall totals table
      h.forEach((k, i) => { const key = SUMMARY[k]; const v = num(t.rows[0][i]); if (key && v != null) metrics[key] = v; });
      used++;
      continue;
    }
    if (!t.rows.length) continue;
    const dim = h[0];
    const rows = t.rows.filter((r) => r[0]).map((r) => {
      const m: Record<string, number> = {};
      h.slice(1).forEach((k, i) => { const key = SUMMARY[k] ?? k; const v = num(r[i + 1]); if (v != null) m[key] = v; });
      return { label: r[0], metrics: m };
    });
    if (/session_source_medium|session_source|source_medium/.test(dim) && h.includes("sessions") && !breakdowns.sources) {
      breakdowns.sources = rows.filter((r) => (r.metrics.sessions ?? 0) > 0).sort((a, b) => (b.metrics.sessions ?? 0) - (a.metrics.sessions ?? 0)).slice(0, 60);
      used++;
    } else if (/google_ads_campaign|campaign/.test(dim) && rows.length) {
      breakdowns.campaigns = rows.slice(0, 50);
      used++;
    }
  }

  // Revenue and key events that are all zero aren't tracked: leave them out rather than show R 0.
  for (const k of ["revenue", "key_events"]) if (metrics[k] === 0) delete metrics[k];
  if (breakdowns.sources) for (const r of breakdowns.sources) for (const k of ["revenue", "key_events"]) if (!r.metrics[k]) delete r.metrics[k];

  if (!Object.keys(metrics).length && !breakdowns.sources) errors.push("Couldn’t find the totals table (active users, sessions) in this Google Analytics report.");
  const rows: ParsedRow[] = Object.entries(metrics).map(([metric, value]) => ({ month: month!, channel, metric, value }));
  info.push(`Google Analytics report: read ${used} table${used === 1 ? "" : "s"}, saved under “${channel}”.`);
  if (breakdowns.sources) info.push(`Kept ${breakdowns.sources.length} traffic sources for “Where your visitors came from”.`);

  return {
    rows,
    breakdowns: breakdowns.sources || breakdowns.campaigns ? { [`${month}|${channel}`]: breakdowns } : {},
    hasConversions: false,
    months: month ? [month] : [],
    channels: rows.length ? [channel] : [],
    metrics: rows.map((r) => r.metric),
    warnings,
    info,
    errors,
    detectedSource: "Website",
    sourceRows: ts.reduce((n, t) => n + t.rows.length, 0),
  };
}
