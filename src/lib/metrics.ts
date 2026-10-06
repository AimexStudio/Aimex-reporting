/**
 * Metric catalog. Pure module — safe on server and client.
 *
 * "Base" metrics are stored (summed across channels). "Derived" metrics are
 * always calculated from base metrics so they stay correct when channels are
 * combined — never uploaded.
 */

export type MetricKind = "count" | "currency" | "percent" | "multiple";

export interface MetricDef {
  key: string;
  label: string;
  kind: MetricKind;
  /** Is a rising number good news? Drives green/red on changes. null = neutral (e.g. spend). */
  higherIsBetter: boolean | null;
  /** Column names (normalised) that map to this metric in a CSV. */
  aliases?: string[];
}

export const BASE_METRICS: MetricDef[] = [
  { key: "spend", label: "Ad spend", kind: "currency", higherIsBetter: null, aliases: ["cost", "amount_spent", "ad_spend", "media_spend", "budget_spent"] },
  { key: "impressions", label: "Impressions", kind: "count", higherIsBetter: true, aliases: ["impr", "views"] },
  { key: "reach", label: "Reach", kind: "count", higherIsBetter: true },
  { key: "clicks", label: "Clicks", kind: "count", higherIsBetter: true, aliases: ["link_clicks", "clicks_all"] },
  { key: "conversions", label: "Conversions", kind: "count", higherIsBetter: true, aliases: ["conv", "purchases", "results", "sales", "orders"] },
  { key: "revenue", label: "Revenue", kind: "currency", higherIsBetter: true, aliases: ["conversion_value", "conv_value", "purchase_value", "sales_value", "value"] },
  { key: "leads", label: "Leads", kind: "count", higherIsBetter: true, aliases: ["enquiries", "inquiries", "form_submissions"] },
  { key: "calls", label: "Calls", kind: "count", higherIsBetter: true, aliases: ["phone_calls"] },
  { key: "new_users", label: "New website users", kind: "count", higherIsBetter: true },
  { key: "avg_engagement_time", label: "Avg engagement time (seconds)", kind: "count", higherIsBetter: true },
  { key: "key_events", label: "Key events", kind: "count", higherIsBetter: true },
  { key: "sessions", label: "Website sessions", kind: "count", higherIsBetter: true, aliases: ["visits"] },
  { key: "users", label: "Website users", kind: "count", higherIsBetter: true, aliases: ["visitors", "total_users", "active_users"] },
  { key: "engagements", label: "Engagements", kind: "count", higherIsBetter: true, aliases: ["engagement", "post_engagements", "interactions"] },
  { key: "followers", label: "New followers", kind: "count", higherIsBetter: true, aliases: ["new_followers", "follows", "followers_gained"] },
  { key: "landing_page_views", label: "Landing page views", kind: "count", higherIsBetter: true },
  { key: "conversations", label: "Message conversations", kind: "count", higherIsBetter: true, aliases: ["messaging_conversations_started", "conversations_started"] },
  { key: "video_views", label: "Video views", kind: "count", higherIsBetter: true, aliases: ["thruplays", "views_video"] },
];

export const DERIVED_METRICS: (MetricDef & {
  compute: (m: Record<string, number>) => number | null;
  /** [numerator, denominator] base metrics this rate is built from. */
  inputs: [string, string];
})[] = [
  { key: "roas", inputs: ["revenue", "spend"], label: "Return on ad spend", kind: "multiple", higherIsBetter: true, compute: (m) => div(m.revenue, m.spend) },
  { key: "cpa", inputs: ["result_spend", "conversions"], label: "Cost per conversion", kind: "currency", higherIsBetter: false, compute: (m) => div(m.result_spend ?? m.spend, m.conversions) },
  { key: "cpl", inputs: ["result_spend", "leads"], label: "Cost per lead", kind: "currency", higherIsBetter: false, compute: (m) => div(m.result_spend ?? m.spend, m.leads) },
  { key: "ctr", inputs: ["clicks", "impressions"], label: "Click-through rate", kind: "percent", higherIsBetter: true, compute: (m) => div(m.clicks, m.impressions) },
  { key: "cpc", inputs: ["spend", "clicks"], label: "Cost per click", kind: "currency", higherIsBetter: false, compute: (m) => div(m.spend, m.clicks) },
  { key: "cpm", inputs: ["spend", "impressions"], label: "Cost per 1,000 impressions", kind: "currency", higherIsBetter: false, compute: (m) => { const v = div(m.spend, m.impressions); return v == null ? null : v * 1000; } },
  { key: "lead_rate", inputs: ["leads", "clicks"], label: "Click-to-lead rate", kind: "percent", higherIsBetter: true, compute: (m) => (m.clicks ? div(m.leads, m.clicks) : null) },
  { key: "conv_rate", inputs: ["conversions", "clicks"], label: "Conversion rate", kind: "percent", higherIsBetter: true, compute: (m) => div(m.conversions, m.clicks) },
];

/** CSV columns that are derived here, so an uploaded value would be ignored. */
export const DERIVED_ALIASES = new Set([
  "roas", "cpa", "cpl", "ctr", "cpc", "cpm", "conv_rate", "conversion_rate",
  "cost_per_conversion", "cost_per_click", "cost_per_lead", "cost_per_result",
  "click_through_rate", "return_on_ad_spend",
]);

function div(a?: number, b?: number): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

const ALL = [...BASE_METRICS, ...DERIVED_METRICS];
const DERIVED_KEYS = new Set(DERIVED_METRICS.map((d) => d.key));
const BY_KEY = new Map(ALL.map((m) => [m.key, m]));

export function metricDef(key: string): MetricDef {
  return (
    BY_KEY.get(key) ?? {
      key,
      label: key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      kind: "count",
      higherIsBetter: true,
    }
  );
}

/**
 * Totals across channels, with every rate worked out only from the channels that
 * report both of its inputs. Without this, Google spend would be divided by Meta
 * leads and cost per lead would be badly overstated.
 */
export function deriveTotals(channelsIn: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of channelsIn) for (const [k, v] of Object.entries(c)) if (!DERIVED_KEYS.has(k) && k !== "result_spend") out[k] = (out[k] ?? 0) + v;
  // Spend that produced results: a channel's own figure if known (e.g. excluding blog page-view ad sets), else its spend.
  const channels = channelsIn.map((c) => (c.spend != null ? { ...c, result_spend: c.result_spend ?? c.spend } : c));
  for (const d of DERIVED_METRICS) {
    const [a, b] = d.inputs;
    const scoped = channels.filter((c) => c[a] != null && c[b] != null && c[b] !== 0);
    if (!scoped.length) continue;
    const v = d.compute({ [a]: scoped.reduce((s, c) => s + c[a], 0), [b]: scoped.reduce((s, c) => s + c[b], 0) });
    if (v != null && Number.isFinite(v)) out[d.key] = v;
  }
  return out;
}

/** Adds derived metrics to a bag of base metrics. */
export function withDerived(base: Record<string, number>): Record<string, number> {
  const out = { ...base };
  delete out.result_spend; // internal: only used to work out cost per result
  for (const d of DERIVED_METRICS) {
    const v = d.compute(base);
    if (v != null && Number.isFinite(v)) out[d.key] = v;
  }
  return out;
}

/* ---------- formatting ---------- */

// Formatting is done by hand on top of en-US (whose output is identical in every
// browser and in Node) so server-rendered and client-rendered numbers always match.
const SYMBOL: Record<string, string> = { ZAR: "R\u00A0", USD: "$", GBP: "£", EUR: "€", AUD: "A$" };
const GROUP: Record<string, string> = { ZAR: "\u00A0" };

function plain(v: number, currency: string, maxFrac: number, minFrac = 0, compact = false): string {
  const s = new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: Math.min(minFrac, maxFrac),
  }).format(Math.abs(v));
  const grouped = s.replace(/,/g, GROUP[currency] ?? ",").replace(/([KMB])$/, (m) => (m === "K" ? "k" : m));
  return (v < 0 ? "−" : "") + grouped;
}

export function formatNumber(v: number, currency = "ZAR", maxFrac = 0): string {
  return plain(v, currency, maxFrac);
}

export function formatPercent(v: number, maxFrac = 1): string {
  return `${plain(v * 100, "USD", maxFrac)}%`;
}

export function formatMetric(
  key: string,
  value: number | null | undefined,
  currency: string,
  opts: { compact?: boolean; axis?: boolean; exact?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "–";
  const def = metricDef(key);
  const compact = !!(opts.compact || opts.axis) && Math.abs(value) >= (opts.axis ? 1_000 : 10_000);
  switch (def.kind) {
    case "currency": {
      const small = (Math.abs(value) < 100 && value !== 0) || !!opts.exact;
      const body = plain(value, currency, compact ? 1 : small ? 2 : 0, small && !opts.compact && !opts.axis ? 2 : 0, compact);
      const sign = body.startsWith("−") ? "−" : "";
      return `${sign}${SYMBOL[currency] ?? currency + " "}${body.replace(/^−/, "")}`;
    }
    case "percent":
      return formatPercent(value, 2);
    case "multiple":
      return `${value.toFixed(2)}×`;
    default:
      return plain(value, currency, compact ? 1 : 0, 0, compact);
  }
}

export function pctChange(curr?: number, prev?: number): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return (curr - prev) / Math.abs(prev);
}

/* ---------- months ---------- */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09" -> "September 2026" (long) or "Sep 26" (short). Hand-rolled so every browser renders the same. */
export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[m - 1] ?? "?";
  return style === "long" ? `${name} ${y}` : `${name.slice(0, 3)} ${String(y).slice(2)}`;
}

export function isMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
