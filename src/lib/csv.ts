import Papa from "papaparse";
import { BASE_METRICS, DERIVED_ALIASES, isMonth, monthLabel } from "./metrics";

export interface ParsedRow {
  month: string;
  channel: string;
  metric: string;
  value: number;
}

/** Per-channel detail kept for "What worked best": which ads, ad sets and audiences produced results. */
import type { Breakdowns } from "@/db/types";
export type { Breakdowns };

export interface ParseResult {
  /** keyed "YYYY-MM|Channel" */
  breakdowns: Record<string, Breakdowns>;
  rows: ParsedRow[];
  months: string[];
  channels: string[];
  metrics: string[];
  /** Things the admin should know that changed what was imported. */
  warnings: string[];
  /** Neutral notes about how the file was read. */
  info: string[];
  errors: string[];
  /** e.g. "Meta Ads" when the file looks like an Ads Manager export. */
  detectedSource: string | null;
  sourceRows: number;
  /** File reports conversions without revenue, so they might really be leads. */
  hasConversions: boolean;
}

// Checked in order: the first header present wins.
const MONTH_COLS = ["month", "reporting_month", "period", "reporting_starts", "reporting_start", "date", "day", "month_of_year"];
const CHANNEL_COLS = new Set(["channel", "platform", "source", "network", "publisher_platform"]);

/** Columns that are averages/ratios or dates: adding them up across rows would be wrong. */
const NOT_ADDITIVE = /^(frequency|starts|ends|reporting_ends|reporting_end|results_initial|avg_|average_|cost_per_|cost_conv|cost_all_conv|conv_value_cost|cpm|cpc|cpa|cpl|ctr|roas|budget|optimi[sz]ation_score|quality_score|.*_rate$|.*_per_.*|.*_ratio$|.*_share$|.*_percent(age)?$|bounce_rate|engagement_rate)/;
/** Unique-people counts: the same person can appear in several rows, so sums overstate them. */
const UNIQUE_COUNTS = new Set(["reach", "users"]);
const DIM = {
  ads: ["ad_name", "ad"],
  adSets: ["ad_set_name", "adset_name", "ad_group", "ad_group_name"],
  campaigns: ["campaign_name", "campaign"],
  age: ["age", "age_range"],
  gender: ["gender"],
} as const;

const aliasMap = new Map<string, string>();
for (const m of BASE_METRICS) {
  aliasMap.set(m.key, m.key);
  for (const a of m.aliases ?? []) aliasMap.set(a, m.key);
}

export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    // drop unit/currency brackets only: "Amount spent (ZAR)" -> "amount spent", but keep "Results (initial)"
    .replace(/\((zar|usd|gbp|eur|aud|rand|r|\$|£|€|%)\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Accepts 2026-09, 2026/09, 2026-09-01, 09/2026, Sep 2026, September 2026, Sep-26. */
export function parseMonth(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:[ t].*)?$/);
  if (m) return fmt(+m[1], +m[2]);
  m = s.match(/^\d{1,2}[-/.](\d{1,2})[-/.](\d{4})$/); // 01/09/2026 (day first)
  if (m) return fmt(+m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return fmt(+m[2], +m[1]);
  m = s.match(/^([a-z]{3,9})[\s\-/,]*(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4)] ?? MONTHS[m[1].slice(0, 3)];
    const yr = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    if (mon) return fmt(yr, mon);
  }
  return null;
}

function fmt(y: number, mo: number) {
  const s = `${y}-${String(mo).padStart(2, "0")}`;
  return isMonth(s) ? s : null;
}

/** True only for cells that are genuinely a number: "R 12 345,67", "$1,234.50", "45%", "1200". */
export function isNumericCell(raw: string): boolean {
  const s = raw.trim();
  if (!s || !/\d/.test(s)) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return false; // dates
  return /^[-−]?\s*(r|\$|£|€|zar|usd|gbp|eur|aud)?\s*[-−]?[\d\s\u00a0.,']+\s*%?$/i.test(s);
}

/** Handles "R 12 345,67", "$12,345.67", "12.345,67", "1,234", "45%". Empty or text -> null. */
export function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!isNumericCell(str)) return null;
  const neg = /^[-−]/.test(str) || /[a-z$£€]\s*[-−]/i.test(str);
  let s = str.replace(/[^\d.,]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot > -1 && lastComma > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** Blank markers platforms use for "no value": Google Ads shows "--". */
const isBlank = (v: string) => /^\s*(-{1,2}|–|—|n\/a|null)?\s*$/i.test(v);

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Every calendar month mentioned as a date in a line: "1 September 2026", "Sep 1, 2026", "2026-09-01". */
function monthsInLine(line: string): string[] {
  const out: string[] = [];
  const name = (n: string) => MONTH_NAMES[n.toLowerCase()] ?? Object.entries(MONTH_NAMES).find(([k]) => k.startsWith(n.toLowerCase().slice(0, 3)))?.[1];
  for (const m of line.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) { const mo = name(m[2]); if (mo) out.push(fmt(+m[3], mo) ?? ""); }
  for (const m of line.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) { const mo = name(m[1]); if (mo) out.push(fmt(+m[3], mo) ?? ""); }
  for (const m of line.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.]\d{1,2}\b/g)) out.push(fmt(+m[1], +m[2]) ?? "");
  return out.filter(Boolean);
}

/**
 * Platform exports often start with title lines before the real column headings
 * (Google Ads: "Campaign report", then a date range). Finds the heading row as the
 * first row with the most common column count, and returns what came before it.
 */
/**
 * Tab-separated files (Google Ads "CSV (Excel)") often contain commas inside numbers
 * like "1,204", which confuses automatic detection, so tabs are checked first.
 */
function detectDelimiter(text: string): string | undefined {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 20);
  const tabbed = lines.filter((l) => l.includes("\t")).length;
  return lines.length && tabbed / lines.length >= 0.5 ? "\t" : undefined;
}

function splitPreamble(text: string, delimiter?: string): { body: string; preamble: string[] } {
  const probe = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", preview: 60, delimiter });
  const rows = probe.data;
  if (rows.length < 2) return { body: text, preamble: [] };
  const counts = new Map<number, number>();
  for (const r of rows) if (r.length > 1) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  if (!counts.size) return { body: text, preamble: [] };
  const width = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const headerIdx = rows.findIndex((r) => r.length === width);
  if (headerIdx <= 0) return { body: text, preamble: [] };
  const lines = text.split(/\r\n|\n|\r/);
  let seen = 0;
  let cut = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (seen === headerIdx) { cut = i; break; }
    seen++;
  }
  return { body: lines.slice(cut).join("\n"), preamble: lines.slice(0, cut).map((l) => l.trim()).filter(Boolean) };
}

/** Meta's "Results" column means different things depending on the campaign objective. */
function resultMetric(type: string): string | null {
  const t = type.trim().toLowerCase();
  if (!t) return null;
  if (/lead/.test(t)) return "leads";
  if (/purchase|conversion|sale|checkout/.test(t)) return "conversions";
  if (/link click|^clicks?$/.test(t)) return "clicks";
  if (/landing page view/.test(t)) return "landing_page_views";
  if (/messag|conversation/.test(t)) return "conversations";
  if (/call/.test(t)) return "calls";
  if (/follow|page like/.test(t)) return "followers";
  if (/thruplay|video/.test(t)) return "video_views";
  if (/engagement/.test(t)) return "engagements";
  if (/reach|impression/.test(t)) return null; // already in their own columns
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function detectSource(h: Set<string>): string | null {
  if (h.has("amount_spent") && (h.has("ad_set_name") || h.has("result_type") || h.has("frequency"))) return "Meta Ads";
  if ((h.has("cost") || h.has("cost_micros")) && (h.has("impr") || h.has("conv") || h.has("conversions")) ) return "Google Ads";
  if (h.has("sessions") && (h.has("total_users") || h.has("engaged_sessions"))) return "Website";
  return null;
}

/**
 * Reads a CSV of marketing numbers into tall rows (month, channel, metric, value).
 *
 * Works with a hand-made "one row per channel" sheet, and with raw platform
 * exports broken down by ad, age, gender etc.: those rows are added up per
 * channel and month, text columns are ignored, and averages are recalculated.
 */
export interface ParseOptions {
  /** Count the platform's "conversions" as leads (e.g. Google Ads conversions that are form fills). */
  conversionsAs?: "conversions" | "leads";
}

export function parseMetricsCsv(text: string, formMonth?: string, defaultChannel?: string, opts: ParseOptions = {}): ParseResult {
  let defaultMonth = formMonth;
  const warnings: string[] = [];
  const info: string[] = [];
  const errors: string[] = [];
  const original = new Map<string, string>();
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);
  const { body, preamble } = splitPreamble(clean, delimiter);
  if (preamble.length) {
    info.push(`Skipped ${preamble.length} title line${preamble.length === 1 ? "" : "s"} above the column headings (${preamble.map((l) => `“${l.replace(/^"|"$/g, "").slice(0, 60)}”`).join(", ")}).`);
  }
  // The report's own date range (e.g. "1 September 2026 - 30 September 2026") sets the month.
  const rangeMonths = [...new Set(preamble.flatMap(monthsInLine))];
  if (rangeMonths.length === 1) {
    if (defaultMonth && defaultMonth !== rangeMonths[0]) info.push(`Used ${monthLabel(rangeMonths[0])} from the report’s date range rather than the month picked in the form.`);
    defaultMonth = rangeMonths[0];
  } else if (rangeMonths.length > 1) {
    warnings.push(`The report’s date range covers more than one month (${rangeMonths.map((m) => monthLabel(m)).join(" to ")}). Its figures are saved under ${defaultMonth ? monthLabel(defaultMonth) : "the month picked in the form"}. Export one calendar month at a time for exact monthly figures.`);
  }
  const parsed = Papa.parse<Record<string, string>>(body, {
    delimiter,
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => {
      const n = normaliseHeader(h);
      if (!original.has(n)) original.set(n, h.trim());
      return n;
    },
  });
  const label = (h: string) => original.get(h) ?? h;

  for (const e of parsed.errors.filter((e) => e.code !== "UndetectableDelimiter").slice(0, 5)) {
    errors.push(`Row ${(e.row ?? 0) + 2}: ${e.message}`);
  }

  const data = parsed.data;
  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const hset = new Set(headers);
  const detectedSource = detectSource(hset);
  const monthCol = MONTH_COLS.find((c) => hset.has(c));
  const channelCol = headers.find((h) => CHANNEL_COLS.has(h));
  const resultTypeCol = hset.has("result_type") && hset.has("results") ? "result_type" : undefined;
  const fallbackChannel = defaultChannel?.trim() || detectedSource || "All channels";

  if (!monthCol && !defaultMonth) {
    errors.push("The file has no month or date column. Add one, or pick the month in the upload form.");
  }

  // Classify every other column by its contents, not just its name.
  const metricCols: { col: string; metric: string }[] = [];
  const ignoredRates: string[] = [];
  const detailCols: string[] = [];
  for (const h of headers) {
    if (h === monthCol || h === channelCol || h === resultTypeCol) continue;
    const values = data.map((r) => (r[h] ?? "").trim()).filter((v) => v && !isBlank(v));
    if (values.length === 0) continue; // empty column
    const numeric = values.filter(isNumericCell).length / values.length;
    if (numeric < 0.9) {
      if (new Set(values).size > 1) detailCols.push(label(h));
      continue;
    }
    if (DERIVED_ALIASES.has(h) || NOT_ADDITIVE.test(h)) {
      ignoredRates.push(label(h));
      continue;
    }
    if (h === "results" && resultTypeCol) continue; // handled per row below
    metricCols.push({ col: h, metric: aliasMap.get(h) ?? h });
  }

  if (ignoredRates.length) {
    warnings.push(`Not imported: ${ignoredRates.join(", ")}. Averages and rates are recalculated from the totals so they stay correct.`);
  }
  const directMetrics = new Set(metricCols.map((m) => m.metric));
  if (metricCols.length === 0 && !resultTypeCol) {
    errors.push("No number columns found. Expected columns like amount spent, impressions, clicks or leads.");
  }

  const dimCol = Object.fromEntries(
    Object.entries(DIM).map(([k, names]) => [k, names.find((n) => hset.has(n))]),
  ) as Record<keyof typeof DIM, string | undefined>;
  type BdMaps = { ads: Map<string, Record<string, number>>; adSets: Map<string, Record<string, number>>; campaigns: Map<string, Record<string, number>>; audiences: Map<string, Record<string, number>> };
  const bdMaps = new Map<string, BdMaps>();
  type Attr = { delivery?: string; resultType?: string; budget?: number; budgetType?: string; optScore?: number; reach?: number; parent?: string };
  const rowCounts = new Map<string, number>();
  const rowAttrs = new Map<string, Attr>();
  // Text details seen across all of a label's lines: kept when every line agrees (e.g. one result type).
  const seenText = new Map<string, Map<string, Set<string>>>();
  const agg = new Map<string, ParsedRow>();
  const rowsPerKey = new Map<string, number>();
  const resultTypes = new Map<string, number>();
  let skippedTotals = 0;
  const outOfMonth = new Set<string>();

  data.forEach((r, i) => {
    const line = i + 2;
    let month = defaultMonth ?? "";
    if (monthCol) {
      const raw = (r[monthCol] ?? "").trim();
      const pm = parseMonth(raw);
      if (pm) month = pm;
      else if (raw) {
        errors.push(`Row ${line}: couldn’t read “${raw}” as a month or date. Use a format like 2026-09.`);
        return;
      } else if (!defaultMonth) {
        errors.push(`Row ${line}: the month is empty.`);
        return;
      }
    }
    if (!month) return;
    if (hset.has("reporting_ends")) {
      const end = parseMonth(r["reporting_ends"] ?? "");
      if (end && end !== month) outOfMonth.add(`${label(monthCol ?? "")} ${r[monthCol ?? ""]} to ${r["reporting_ends"]}`);
    }

    const channel = (channelCol ? r[channelCol]?.trim() : "") || fallbackChannel;
    const firstCell = Object.values(r)[0]?.trim() ?? "";
    const anyCellTotal = Object.values(r).slice(0, 3).some((v) => /^\s*(total|totals|grand total)\b/i.test(v ?? ""));
    if (/^(total|totals|grand total|all|summary)$/i.test(channel) || /^(total|totals|grand total)\b/i.test(firstCell) || anyCellTotal) {
      skippedTotals++;
      return;
    }

    const key = `${month}|${channel}`;
    rowsPerKey.set(key, (rowsPerKey.get(key) ?? 0) + 1);
    const add = (metric: string, value: number) => {
      const k = `${key}|${metric}`;
      const ex = agg.get(k);
      agg.set(k, ex ? { ...ex, value: ex.value + value } : { month, channel, metric, value });
    };

    const rowMetrics: Record<string, number> = {};
    for (const { col, metric } of metricCols) {
      const v = parseNumber(r[col]);
      if (v != null) rowMetrics[metric] = (rowMetrics[metric] ?? 0) + v;
    }
    if (resultTypeCol) {
      const v = parseNumber(r["results"]);
      const type = (r[resultTypeCol] ?? "").trim();
      const metric = resultMetric(type);
      // skip if the file already has its own column for this measure (avoids double counting)
      if (v != null && v !== 0 && metric && !directMetrics.has(metric)) {
        rowMetrics[metric] = (rowMetrics[metric] ?? 0) + v;
        resultTypes.set(type, (resultTypes.get(type) ?? 0) + v);
      }
    }
    for (const [m, v] of Object.entries(rowMetrics)) add(m, v);

    // Keep the detail for "What worked best" (unique-people counts can't be split this way).
    const bd = bdMaps.get(key) ?? { ads: new Map(), adSets: new Map(), campaigns: new Map(), audiences: new Map() };
    bdMaps.set(key, bd);
    const additive = Object.entries(rowMetrics).filter(([m]) => !UNIQUE_COUNTS.has(m));
    const bump = (map: Map<string, Record<string, number>>, label: string, kind?: string) => {
      if (!label) return;
      const cur = map.get(label) ?? {};
      for (const [m, v] of additive) cur[m] = (cur[m] ?? 0) + v;
      map.set(label, cur);
      if (kind) {
        // Remember the first line's details; they're only shown if this label has exactly one line.
        const k = `${key}|${kind}|${label}`;
        rowCounts.set(k, (rowCounts.get(k) ?? 0) + 1);
        const texts = seenText.get(k) ?? new Map<string, Set<string>>();
        seenText.set(k, texts);
        const note = (field: string, v: string | undefined) => { if (v) { const set = texts.get(field) ?? new Set(); set.add(v); texts.set(field, set); } };
        note("resultType", resultTypeCol ? r[resultTypeCol]?.trim() : undefined);
        note("delivery", ["delivery_status", "delivery", "campaign_status", "ad_set_delivery", "status"].map((n) => (r[n] ?? "").trim()).find((v) => v && !isBlank(v)));
        if (kind === "adSets" && dimCol.campaigns) note("parent", (r[dimCol.campaigns] ?? "").trim().replace(/\s+/g, " "));
        if (!rowAttrs.has(k)) {
          const pick = (names: string[]) => names.map((n) => (r[n] ?? "").trim()).find((v) => v && !isBlank(v));
          const reach = parseNumber(r["reach"]);
          rowAttrs.set(k, {
            delivery: pick(["delivery_status", "delivery", "campaign_status", "ad_set_delivery", "status"]),
            resultType: (resultTypeCol ? r[resultTypeCol]?.trim() : undefined) || undefined,
            budget: parseNumber(pick(["budget", "ad_set_budget", "daily_budget", "campaign_budget"]) ?? "") ?? undefined,
            budgetType: pick(["budget_type", "ad_set_budget_type"]),
            optScore: parseNumber(pick(["optimisation_score", "optimization_score"]) ?? "") ?? undefined,
            reach: reach ?? undefined,
          });
        }
      }
    };
    if (dimCol.ads) bump(bd.ads, (r[dimCol.ads] ?? "").trim(), "ads");
    if (dimCol.adSets) bump(bd.adSets, (r[dimCol.adSets] ?? "").trim().replace(/\s+/g, " "), "adSets");
    if (dimCol.campaigns) bump(bd.campaigns, (r[dimCol.campaigns] ?? "").trim().replace(/\s+/g, " "), "campaigns");
    if (dimCol.age || dimCol.gender) {
      const age = (dimCol.age ? r[dimCol.age] : "")?.trim() || "All ages";
      const gender = (dimCol.gender ? r[dimCol.gender] : "")?.trim().toLowerCase() || "all";
      bump(bd.audiences, `${age}|${gender}`);
    }
  });

  // Unique-people counts can't be added across split rows.
  const droppedUnique = new Set<string>();
  for (const [k, row] of agg) {
    if (UNIQUE_COUNTS.has(row.metric) && (rowsPerKey.get(`${row.month}|${row.channel}`) ?? 0) > 1) {
      agg.delete(k);
      droppedUnique.add(row.metric);
    }
  }

  const sourceRows = [...rowsPerKey.values()].reduce((a, b) => a + b, 0);
  if (droppedUnique.size) {
    const what = [...droppedUnique].join(" and ");
    warnings.push(
      `Not imported: ${what}. This file splits each channel across several rows (by ${detailCols.slice(0, 3).join(", ") || "breakdown"}), and the same people appear in more than one row, so adding them up would overstate ${what}. For accurate ${what}, export at campaign level with no breakdowns.`,
    );
  }
  for (const [type, n] of resultTypes) {
    info.push(`Meta “Results” of type “${type}” were imported as ${labelFor(resultMetric(type)!)} (${n}).`);
  }
  if (!channelCol && sourceRows > 0) {
    info.push(
      detectedSource && !defaultChannel?.trim()
        ? `Looks like a ${detectedSource} export, so the figures are saved under ${detectedSource}.`
        : `Saved under “${fallbackChannel}”${defaultChannel?.trim() ? ", from the Channel field" : ""}.`,
    );
  }
  const distinctKeys = rowsPerKey.size;
  if (sourceRows > distinctKeys) {
    info.push(`Added up ${sourceRows} rows into ${distinctKeys} channel total${distinctKeys === 1 ? "" : "s"}.`);
  }
  if (skippedTotals) info.push(`Skipped ${skippedTotals} total row${skippedTotals === 1 ? "" : "s"}; totals are worked out from the other rows.`);
  if (outOfMonth.size) {
    warnings.push(`Some rows cover more than one calendar month (${[...outOfMonth][0]}). They were counted in the month they start. Export one month at a time for exact monthly figures.`);
  }

  const round = (v: number) => Math.round(v * 10_000) / 10_000; // trims float noise like 22301.90000000001
  const rows = [...agg.values()].map((r) => ({ ...r, value: round(r.value) }));
  for (const bd of bdMaps.values()) for (const map of Object.values(bd)) for (const m of map.values()) for (const k in m) m[k] = round(m[k]);
  if (rows.length === 0 && errors.length === 0) errors.push("No numbers found in the file.");

  // Refuse the downloadable template's example figures, which would replace a client's real numbers.
  if (rows.length && !checkingTemplate && sameFigures(rows, templateRows())) {
    errors.push("This is the unchanged example template. Replace the example numbers with the client’s real figures before importing.");
  }

  // A revenue column that is all zero means conversion values aren't tracked (Google Ads
  // always includes "Conv. value"). Saving R 0 would show a 0× return, so leave it out.
  const zeroRevenue = new Set<string>();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].metric === "revenue" && rows[i].value === 0) { zeroRevenue.add(rows[i].channel); rows.splice(i, 1); }
  }
  if (zeroRevenue.size) {
    for (const bd of bdMaps.values()) for (const map of Object.values(bd)) for (const m of map.values()) if (m.revenue === 0) delete m.revenue;
    info.push(`Revenue (conversion value) is zero in this file, so it wasn’t imported. It usually means conversion values aren’t tracked.`);
  }

  // Optional: treat conversions as leads, unless the file already has its own leads.
  const remap = opts.conversionsAs === "leads" && rows.some((r) => r.metric === "conversions") && !rows.some((r) => r.metric === "leads");
  if (remap) {
    for (const r of rows) if (r.metric === "conversions") r.metric = "leads";
    for (const bd of bdMaps.values()) for (const map of Object.values(bd)) for (const m of map.values()) {
      if (m.conversions != null) { m.leads = (m.leads ?? 0) + m.conversions; delete m.conversions; }
    }
    info.push("Conversions are counted as leads, as chosen for this file.");
  }
  const toRows = (m: Map<string, Record<string, number>>, key: string, kind: string, minRows = 2) =>
    m.size >= minRows
      ? [...m].map(([label, metrics]) => {
          const k = `${key}|${kind}|${label}`;
          const single = rowCounts.get(k) === 1;
          const a = rowAttrs.get(k) ?? {};
          const { reach, ...rest } = a;
          // Text details that are the same on every line (result type, delivery, parent campaign) are always kept.
          const agreed = Object.fromEntries([...(seenText.get(k) ?? new Map<string, Set<string>>())].filter(([, v]) => v.size === 1).map(([f, v]) => [f, [...v][0]]));
          const attrs = Object.fromEntries(Object.entries(single ? { ...rest, ...agreed } : agreed).filter(([, v]) => v !== undefined && v !== ""));
          // reach can only be shown when the export has one line for this row
          const withReach = single && reach != null ? { ...metrics, reach } : metrics;
          return { label, metrics: withReach, ...(Object.keys(attrs).length ? { attrs } : {}) };
        }).sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0)).slice(0, 50)
      : undefined;
  const breakdowns: Record<string, Breakdowns> = {};
  const kept = new Set<string>();
  for (const [key, bd] of bdMaps) {
    const audiences = bd.audiences.size >= 2
      ? [...bd.audiences].map(([k, metrics]) => { const [age, gender] = k.split("|"); return { age, gender, metrics }; }).slice(0, 60)
      : undefined;
    // Campaigns are kept even when there's only one, so the channel page can show its full row.
    const b: Breakdowns = { ads: toRows(bd.ads, key, "ads"), adSets: toRows(bd.adSets, key, "adSets", 1), campaigns: toRows(bd.campaigns, key, "campaigns", 1), audiences };
    if (b.ads) kept.add("ads");
    if (b.adSets) kept.add("ad sets");
    if (b.campaigns) kept.add("campaigns");
    if (b.audiences) kept.add("age and gender");
    if (b.ads || b.adSets || b.campaigns || b.audiences) breakdowns[key] = b;
  }
  if (kept.size) info.push(`Kept the breakdown by ${[...kept].join(", ")} for the “What worked best” section.`);

  return {
    rows,
    breakdowns,
    hasConversions: rows.some((r) => r.metric === "conversions" || (remap && r.metric === "leads")) && !rows.some((r) => r.metric === "revenue"),
    months: [...new Set(rows.map((r) => r.month))].sort(),
    channels: [...new Set(rows.map((r) => r.channel))],
    metrics: [...new Set(rows.map((r) => r.metric))],
    warnings,
    info,
    errors: [...new Set(errors)].slice(0, 10),
    detectedSource,
    sourceRows,
  };
}

function labelFor(metric: string) {
  const m = BASE_METRICS.find((b) => b.key === metric);
  return (m?.label ?? metric.replace(/_/g, " ")).toLowerCase();
}

function sameFigures(a: ParsedRow[], b: ParsedRow[]) {
  if (!b.length || a.length !== b.length) return false;
  const key = (r: ParsedRow) => `${r.month}|${r.channel}|${r.metric}|${r.value}`;
  const set = new Set(b.map(key));
  return a.every((r) => set.has(key(r)));
}

let checkingTemplate = false;
let cachedTemplate: ParsedRow[] | null = null;
function templateRows(): ParsedRow[] {
  if (!cachedTemplate) {
    checkingTemplate = true;
    try { cachedTemplate = parseMetricsCsv(CSV_TEMPLATE, "2026-09").rows; } finally { checkingTemplate = false; }
  }
  return cachedTemplate;
}

export const CSV_TEMPLATE = `month,channel,spend,impressions,clicks,conversions,revenue,leads,sessions
2026-09,Google Ads,15000,120000,3400,180,92000,,
2026-09,Meta Ads,9000,310000,4100,95,41000,60,
2026-09,Website,,,,,,,8200
`;
