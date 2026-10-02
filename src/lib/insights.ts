/** Pure helpers for the client dashboard's insights. Safe on server and client. */
import type { AudienceRow, Breakdowns, BreakdownRow } from "@/db/types";
import { formatMetric, metricDef } from "./metrics";

/** The outcome a client paid for, in order of preference. */
const OUTCOMES = ["leads", "conversions", "calls", "conversations", "landing_page_views", "clicks"];

export function outcomeMetric(totals: Record<string, number>): string | null {
  // Clients who track sales care most about conversions; lead-gen clients about leads.
  if ((totals.revenue ?? 0) > 0 && (totals.conversions ?? 0) > 0) return "conversions";
  return OUTCOMES.find((k) => (totals[k] ?? 0) > 0) ?? null;
}

export function outcomeNoun(metric: string, n = 2): string {
  const plural: Record<string, [string, string]> = {
    leads: ["lead", "leads"],
    conversions: ["conversion", "conversions"],
    calls: ["call", "calls"],
    conversations: ["conversation", "conversations"],
    landing_page_views: ["website visit", "website visits"],
    clicks: ["click", "clicks"],
  };
  const p = plural[metric] ?? [metricDef(metric).label.toLowerCase(), metricDef(metric).label.toLowerCase()];
  return n === 1 ? p[0] : p[1];
}

/**
 * Strips noise shared by every label so names read cleanly:
 * "BRRVII | Image ad 1", "BRRVII | Video ad 1" -> "Image ad 1", "Video ad 1";
 * "X | Re-Targeting | May 2026 - Copy" -> "Re-Targeting".
 */
export function cleanLabels(labels: string[]): Map<string, string> {
  const split = labels.map((l) => l.replace(/\s*-\s*copy(\s*\d+)?\s*$/i, "").split("|").map((s) => s.trim()).filter(Boolean));
  const out = new Map<string, string>();
  if (labels.length < 2) {
    labels.forEach((l, i) => out.set(l, split[i].join(" | ") || l));
    return out;
  }
  const minLen = Math.min(...split.map((s) => s.length));
  let lead = 0;
  while (lead < minLen - 1 && split.every((s) => s[lead] === split[0][lead])) lead++;
  let trail = 0;
  while (trail < minLen - lead - 1 && split.every((s) => s[s.length - 1 - trail] === split[0][split[0].length - 1 - trail])) trail++;
  // also drop trailing month labels like "May 2026" that differ only by date
  labels.forEach((l, i) => {
    let parts = split[i].slice(lead, split[i].length - trail);
    if (parts.length > 1) parts = parts.filter((p) => !/^[a-z]{3,9}\s+\d{4}$/i.test(p));
    out.set(l, parts.join(" | ") || l);
  });
  return out;
}

export interface RankedRow {
  key: string;
  label: string;
  spend: number;
  outcome: number;
  costPer: number | null;
  share: number; // of all outcomes
}

export function rank(rows: BreakdownRow[], metric: string): RankedRow[] {
  const total = rows.reduce((s, r) => s + (r.metrics[metric] ?? 0), 0);
  const names = cleanLabels(rows.map((r) => r.label));
  return rows
    .map((r) => {
      const outcome = r.metrics[metric] ?? 0;
      const spend = r.metrics.spend ?? 0;
      return {
        key: r.label,
        label: names.get(r.label) ?? r.label,
        spend,
        outcome,
        costPer: outcome > 0 && spend > 0 ? spend / outcome : null,
        share: total > 0 ? outcome / total : 0,
      };
    })
    .sort((a, b) => b.outcome - a.outcome || b.spend - a.spend);
}

/**
 * Lowest cost per outcome among rows that delivered a meaningful share, and only
 * when it's genuinely cheaper (at least 10% below the average), so the badge
 * never celebrates a rounding difference or an ad with one lead.
 */
export function bestValue(rows: RankedRow[], minShare = 0.1): RankedRow | null {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const outcome = rows.reduce((s, r) => s + r.outcome, 0);
  const avg = outcome > 0 ? spend / outcome : null;
  const eligible = rows.filter((r) => r.costPer != null && r.share >= minShare);
  const best = eligible.sort((a, b) => a.costPer! - b.costPer!)[0];
  return best && avg != null && best.costPer! <= avg * 0.9 ? best : null;
}

/* ---------------- audiences ---------------- */

const GENDER_LABEL: Record<string, string> = { female: "Women", male: "Men", unknown: "Not specified", all: "Everyone" };
export const genderLabel = (g: string) => GENDER_LABEL[g] ?? g.charAt(0).toUpperCase() + g.slice(1);

const ageStart = (a: string) => {
  const m = a.match(/\d+/);
  return m ? +m[0] : 999;
};

export function audienceGrid(rows: AudienceRow[], metric: string) {
  const ages = [...new Set(rows.map((r) => r.age))].sort((a, b) => ageStart(a) - ageStart(b));
  const order = ["female", "male", "unknown", "all"];
  const genders = [...new Set(rows.map((r) => r.gender))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const cell = new Map(rows.map((r) => [`${r.age}|${r.gender}`, r.metrics]));
  const total = rows.reduce((s, r) => s + (r.metrics[metric] ?? 0), 0);
  const max = Math.max(1, ...rows.map((r) => r.metrics[metric] ?? 0));
  const cells = rows.map((r) => {
    const outcome = r.metrics[metric] ?? 0;
    const spend = r.metrics.spend ?? 0;
    return { age: r.age, gender: r.gender, outcome, spend, costPer: outcome > 0 && spend > 0 ? spend / outcome : null, share: total ? outcome / total : 0 };
  });
  const top = [...cells].sort((a, b) => b.outcome - a.outcome)[0];
  const totalSpend = cells.reduce((s, c) => s + c.spend, 0);
  const avg = total > 0 ? totalSpend / total : null;
  const cheapest = cells.filter((c) => c.costPer != null && c.share >= 0.05).sort((a, b) => a.costPer! - b.costPer!)[0];
  const value = cheapest && avg != null && cheapest.costPer! <= avg * 0.9 ? cheapest : undefined;
  // Age bands combined across genders, for a simpler "which ages" answer.
  const byAge = ages.map((age) => {
    const rs = cells.filter((c) => c.age === age);
    const outcome = rs.reduce((s, c) => s + c.outcome, 0);
    const spend = rs.reduce((s, c) => s + c.spend, 0);
    return { age, outcome, spend, share: total ? outcome / total : 0, costPer: outcome && spend ? spend / outcome : null };
  });
  return { ages, genders, cell, cells, total, max, top, value, byAge };
}

export function audienceName(age: string, gender: string) {
  const who = genderLabel(gender);
  if (age === "All ages") return who;
  return gender === "all" || gender === "unknown" ? `People aged ${age}` : `${who} aged ${age}`;
}

/* ---------------- sentences ---------------- */

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function insightSentences(b: Breakdowns, metric: string, currency: string): string[] {
  const out: string[] = [];
  const noun = outcomeNoun(metric);
  const units = b.ads?.length ? b.ads : b.campaigns;
  if (units?.length) {
    const r = rank(units, metric);
    if (r[0]?.outcome > 0) {
      const topTwo = r[1] && r[1].outcome > 0 && r[0].share < 0.7 ? r.slice(0, 2) : r.slice(0, 1);
      const share = topTwo.reduce((s, x) => s + x.share, 0);
      out.push(
        topTwo.length === 2
          ? `${topTwo[0].label} and ${topTwo[1].label} brought in ${pct(share)} of your ${noun}.`
          : `${topTwo[0].label} brought in ${pct(share)} of your ${noun}.`,
      );
    }
  }
  if (b.adSets && b.adSets.length >= 2) {
    const r = rank(b.adSets, metric).filter((x) => x.costPer != null);
    if (r.length >= 2) {
      const sorted = [...r].sort((a, c) => a.costPer! - c.costPer!);
      const cheap = sorted[0];
      const dear = sorted[sorted.length - 1];
      const saving = 1 - cheap.costPer! / dear.costPer!;
      if (saving >= 0.1) {
        out.push(
          `${cheap.label} found ${noun} at ${formatMetric("cpl", cheap.costPer, currency)} each, ${pct(saving)} less than ${dear.label} (${formatMetric("cpl", dear.costPer, currency)}).`,
        );
      }
    }
  }
  if (b.audiences?.length) {
    const g = audienceGrid(b.audiences, metric);
    if (g.top && g.top.outcome > 0) {
      out.push(`${audienceName(g.top.age, g.top.gender)} responded most: ${g.top.outcome} ${noun}, ${pct(g.top.share)} of the total.`);
    }
  }
  return out;
}
