"use client";

import { useMemo, useState } from "react";
import type { Breakdowns, BreakdownRow, Goal, Milestone, SectionNotes } from "@/db/types";
import type { MonthData } from "@/lib/data";
import { formatMetric, formatPercent, metricDef, monthLabel, withDerived } from "@/lib/metrics";
import { outcomeMetric, outcomeNoun } from "@/lib/insights";
import { SectionHead, benchmarkText, type Benchmark } from "./Dashboard";
import { useWords } from "./period-context";
import { monthOfPeriod, periodName } from "@/lib/period";
import { MetricIcon } from "./icons";
import { Donut } from "./charts";
import type { SalesSnapshot } from "@/db/types";
import { previousSnapshot, snapshotFor, statusColor, summarize } from "@/lib/sales";
import { addDays, dailyMatches, focusColor, monthSplit, mondayOf, paceSeries, roomOutlook, roomRates, weeksAhead, type MonthOutlook, type RoomSnapshot } from "@/lib/room-sales";
import { GROUP_LABEL, MARKETING_CHANNELS, type ChannelGroup } from "@/lib/marketing-channels";
import { ChannelIcon } from "./ChannelIcon";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const card = "rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8";

/* ================= written insights and warnings ================= */

/** Aimex's written analysis for a section: numbered insights, plus an optional warning box. */
export function NotesPanel({ notes, title }: { notes?: SectionNotes; title: string }) {
  if (!notes || (!notes.insights.length && !notes.alertTitle && !notes.alertBody)) return null;
  return (
    <div className="grid grid-cols-1 gap-6">
      {(notes.alertTitle || notes.alertBody) && (
        <section role="note" className="rounded-3xl border border-bad/30 bg-bad-soft/60 p-6 sm:p-8">
          <h3 className="flex items-center gap-2 font-semibold uppercase tracking-wide text-bad">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2 20h20L12 3zM12 10v4M12 17h.01" />
            </svg>
            {notes.alertTitle || "Please note"}
          </h3>
          {notes.alertBody && <p className="mt-3 max-w-4xl whitespace-pre-line leading-relaxed text-ink">{notes.alertBody}</p>}
        </section>
      )}
      {notes.insights.length > 0 && (
        <section className={card}>
          <SectionHead light={title} bold="insights" lead="What the numbers mean, from your Aimex Studio team." />
          <ol className="grid gap-x-10 gap-y-5 md:grid-cols-2">
            {notes.insights.map((line, i) => {
              const m = line.match(/^([^:]{3,80}):\s*(.+)$/); // "Title: explanation" gets a bold title
              return (
                <li key={i} className="flex gap-3 leading-relaxed">
                  <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-night text-sm text-white">{i + 1}</span>
                  <p>{m ? <><strong>{m[1]}:</strong> {m[2]}</> : line}</p>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

/* ================= channel tiles (channel pages) ================= */

/** The tile row at the top of a channel page, chosen from what that channel's export contains. */
export function ChannelTiles({ m, b, currency, benchmark }: {
  m: Record<string, number> | undefined; b: Breakdowns | null | undefined; currency: string; benchmark?: Benchmark | null;
}) {
  if (!m) return null;
  const outcome = outcomeMetric(m);
  // Spend-weighted optimisation score across campaigns that report one
  const scored = (b?.campaigns ?? []).filter((r) => r.attrs?.optScore != null);
  const scoreSpend = scored.reduce((t, r) => t + (r.metrics.spend ?? 0), 0);
  const optScore = scored.length
    ? scoreSpend > 0 ? scored.reduce((t, r) => t + r.attrs!.optScore! * (r.metrics.spend ?? 0), 0) / scoreSpend
      : scored.reduce((t, r) => t + r.attrs!.optScore!, 0) / scored.length
    : null;
  // Cost per result already leaves out spend that bought other results (see withResultSpend).
  const unit = b?.adSets?.length ? b.adSets : b?.campaigns?.length ? b.campaigns : b?.ads;
  const producing = outcome && unit?.length ? unit.filter((r) => (r.metrics[outcome] ?? 0) > 0) : [];
  const excluded = outcome && unit?.length && producing.length ? unit.filter((r) => !((r.metrics[outcome] ?? 0) > 0) && (r.metrics.spend ?? 0) > 0) : [];
  const cost = outcome === "leads" ? m.cpl ?? null : outcome === "conversions" ? m.cpa ?? null : outcome && m.spend && m[outcome] ? m.spend / m[outcome] : null;
  const excludedTypes = [...new Set(excluded.map((r) => r.attrs?.resultType ?? "other results"))];
  const outcomeTypes = [...new Set(producing.map((r) => r.attrs?.resultType).filter(Boolean))] as string[];
  const bench = cost != null ? benchmarkText(cost, benchmark, currency) : null;
  const n = (v: number) => formatMetric("clicks", v, currency);
  const noun = outcome ? outcomeNoun(outcome) : "";
  const Noun = noun.replace(/^./, (c) => c.toUpperCase());

  type Tile = { key: string; icon: string; label: string; value: React.ReactNode; sub: string; tone?: "brand" | "good" };
  const tiles: Tile[] = [];
  if (optScore != null) tiles.push({ key: "opt", icon: "revenue", label: "Optimisation score", value: `${optScore.toFixed(2)}%`, sub: "Campaign quality score from Google", tone: "brand" });
  if (!m.clicks && m.spend != null) tiles.push({ key: "spend", icon: "spend", label: "Amount spent", value: formatMetric("spend", m.spend, currency, { exact: true }), sub: "Total for the reporting period" });
  if (outcome) tiles.push({
    key: "out", icon: "leads", label: Noun, value: <>{n(m[outcome])}<span className="ml-1.5 text-[0.55em] font-semibold text-ink-2">{noun}</span></>,
    sub: m.clicks ? `${formatPercent(m[outcome] / m.clicks, 2)} of clicks became ${noun}` : outcomeTypes.length ? outcomeTypes.join(", ") : `Total ${noun}`,
  });
  if (cost != null) tiles.push({ key: "cost", icon: "cost", label: `Cost per ${outcomeNoun(outcome!, 1)}`, value: formatMetric("cpl", cost, currency), sub: excluded.length ? `Excludes spend on ${excludedTypes.join(", ").toLowerCase()}` : bench?.text ?? "Average for the month", tone: bench?.good || excluded.length ? "good" : undefined });
  if (m.clicks && m.impressions) tiles.push({ key: "ctr", icon: "impressions", label: "Click-through rate", value: formatPercent(m.clicks / m.impressions, 2), sub: `${n(m.clicks)} clicks on ${n(m.impressions)} impressions` });
  if (!m.clicks && m.impressions) tiles.push({ key: "impr", icon: "impressions", label: "Total impressions", value: n(m.impressions), sub: "Times your ads were shown" });
  if (m.reach) tiles.push({ key: "reach", icon: "leads", label: "Unique reach", value: n(m.reach), sub: "Different people who saw your ads" });
  if (m.reach && m.impressions) tiles.push({ key: "freq", icon: "impressions", label: "Frequency", value: (m.impressions / m.reach).toFixed(2), sub: "Times each person saw your ads, on average" });
  if (m.clicks && m.spend != null && tiles.length < 6) tiles.push({ key: "spend2", icon: "spend", label: "Total cost", value: formatMetric("spend", m.spend, currency, { exact: true }), sub: "Total for the reporting period" });
  if (m.listing_views != null) {
    // Property24 agency statistics
    tiles.length = 0;
    tiles.push({ key: "lv", icon: "impressions", label: "Listing views", value: n(m.listing_views), sub: "Times your listings were viewed" });
    if (m.leads != null) tiles.push({ key: "out", icon: "leads", label: "Leads", value: <>{n(m.leads)}<span className="ml-1.5 text-[0.55em] font-semibold text-ink-2">leads</span></>, sub: m.leads ? `1 lead for every ${n(Math.round(m.listing_views / m.leads))} listing views` : "Enquiries from listings", tone: "good" });
    if (m.active_listings != null) tiles.push({ key: "al", icon: "sessions", label: "Average active listings", value: n(m.active_listings), sub: m.leads && m.active_listings ? `${(m.leads / m.active_listings).toFixed(1)} leads per listing` : "Listings live during the month" });
    if (m.alert_emails != null) tiles.push({ key: "ae", icon: "clicks", label: "Alert emails", value: n(m.alert_emails), sub: m.alerted_listings != null ? `Featuring ${n(m.alerted_listings)} of your listings` : "Sent to property seekers" });
  }
  if (!m.spend && m.sessions != null) {
    // Website (Google Analytics) figures
    tiles.push({ key: "sessions", icon: "sessions", label: "Website sessions", value: n(m.sessions), sub: "Visits to the website" });
    if (m.users != null) tiles.push({ key: "users", icon: "leads", label: "Active users", value: n(m.users), sub: m.sessions && m.users ? `${(m.sessions / m.users).toFixed(2)} visits per person` : "People who used the site" });
    if (m.new_users != null) tiles.push({ key: "new", icon: "leads", label: "New users", value: n(m.new_users), sub: m.users ? `${formatPercent(m.new_users / m.users, 0)} were first-time visitors` : "First-time visitors" });
    if (m.avg_engagement_time != null) tiles.push({ key: "eng", icon: "clicks", label: "Avg engagement time", value: duration(m.avg_engagement_time), sub: "Per active user" });
    if (m.key_events) tiles.push({ key: "ke", icon: "conversions", label: "Key events", value: n(m.key_events), sub: "Enquiries and other tracked actions", tone: "good" });
  }
  if (!tiles.length) return null;
  return (
    <section aria-label="Key figures" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-4">
      {tiles.map((t) => (
        <div key={t.key} className="min-w-0 overflow-hidden rounded-2xl bg-surface p-5 ring-1 ring-line">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words pt-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{t.label}</p>
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><MetricIcon metric={t.icon} className="size-[18px]" /></span>
          </div>
          <p className={`num mt-1 break-words text-[clamp(1.4rem,0.9rem+1.2vw,2rem)] leading-tight ${t.tone === "brand" ? "text-brand-strong" : t.tone === "good" ? "text-good" : "text-ink"}`}>{t.value}</p>
          <p className={`mt-2 text-sm ${t.key === "out" && m.clicks ? "font-medium text-good" : "text-ink-2"}`}>{t.sub}</p>
        </div>
      ))}
    </section>
  );
}

function duration(sec: number) {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/* ================= website traffic sources (Google Analytics) ================= */

/** Groups GA4 "source / medium" values into plain-English groups. */
export function sourceGroup(label: string): string {
  const l = label.toLowerCase();
  if (/^\(direct\)/.test(l)) return "Direct";
  if (/(^|\s)(cpc|ppc|paid)$/.test(l) && /google/.test(l)) return "Google Ads";
  if (/\/\s*organic$/.test(l)) return "Organic search";
  if (/^(fb|ig|facebook|instagram)\b|facebook\.com|instagram\.com/.test(l)) return "Facebook & Instagram";
  if (/ai-assistant|chatgpt|perplexity|gemini|copilot/.test(l)) return "AI assistants";
  if (/\(data not available\)|\(not set\)/.test(l)) return "Unknown";
  if (/\/\s*referral$/.test(l)) return "Other websites";
  if (/email|newsletter|mail/.test(l)) return "Email";
  return "Other";
}

export function TrafficSources({ rows, month }: { rows: BreakdownRow[]; month: string }) {
  const total = rows.reduce((t, r) => t + (r.metrics.sessions ?? 0), 0);
  if (!total) return null;
  const groups = new Map<string, number>();
  for (const r of rows) groups.set(sourceGroup(r.label), (groups.get(sourceGroup(r.label)) ?? 0) + (r.metrics.sessions ?? 0));
  const gData = [...groups].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  const hasKE = rows.some((r) => r.metrics.key_events);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  const n = (v: number) => new Intl.NumberFormat("en-US").format(v).replace(/,/g, "\u00a0");
  const top = gData[0];
  return (
    <section className={card}>
      <SectionHead light="Where your visitors" bold="came from"
        lead={`${top.name} brought the most visits in ${monthLabel(month)}: ${formatPercent(top.value / total, 0)} of sessions by source.`} />
      <div className="grid min-w-0 grid-cols-1 gap-8 min-[1800px]:grid-cols-[minmax(420px,1fr)_minmax(0,1.6fr)]">
        <div className="min-w-0 max-w-xl">
          <h4 className="mb-4 font-semibold">Sessions by type of source</h4>
          <Donut data={gData} format={(v) => `${n(v)} session${v === 1 ? "" : "s"}`} centerValue={n(total)} centerLabel="by source" />
        </div>
        <div className="min-w-0">
          <h4 className="mb-2 font-semibold">Every source</h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line bg-page/70 text-xs uppercase tracking-wide text-ink-2">
                  <th className="px-3 py-2.5 text-left font-semibold">Source / medium</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Type</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Sessions</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Share</th>
                  {hasKE && <th className="px-3 py-2.5 text-right font-semibold">Key events</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.label} className="border-b border-line-soft last:border-0">
                    <th scope="row" className="max-w-[320px] truncate px-3 py-2.5 text-left font-medium" title={r.label}>{r.label}</th>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{sourceGroup(r.label)}</td>
                    <td className="num px-3 py-2.5 text-right">{n(r.metrics.sessions ?? 0)}</td>
                    <td className="px-3 py-2.5 text-right text-ink-2">{formatPercent((r.metrics.sessions ?? 0) / total, 1)}</td>
                    {hasKE && <td className="px-3 py-2.5 text-right">{r.metrics.key_events ? n(r.metrics.key_events) : "–"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 12 && (
            <button type="button" className="mt-3 text-sm font-medium text-brand-strong hover:underline print:hidden" onClick={() => setAll(!all)}>
              {all ? "Show fewer sources" : `Show all ${rows.length} sources`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ================= campaign / ad set table (channel pages) ================= */

export function BreakdownTable({ b, currency, channel, month }: { b: Breakdowns; currency: string; channel: string; month: string }) {
  const rows: BreakdownRow[] | undefined = b.adSets?.length ? b.adSets : b.campaigns?.length ? b.campaigns : b.ads;
  if (!rows?.length) return null;
  const level = b.adSets?.length ? "ad set" : b.campaigns?.length ? "campaign" : "ad";
  const data = rows.map((r) => ({ r, m: withDerived(r.metrics) }));
  const has = (k: string) => data.some((d) => d.m[k] != null);
  const attr = (k: "delivery" | "resultType" | "budget" | "optScore" | "parent") => data.some((d) => d.r.attrs?.[k] != null);
  const outcome = outcomeMetric(data.reduce<Record<string, number>>((t, d) => { for (const [k, v] of Object.entries(d.r.metrics)) t[k] = (t[k] ?? 0) + v; return t; }, {}));
  const withParent = level === "ad set" && attr("parent");
  const clicks = has("clicks");
  type D = (typeof data)[number];
  type Col = { key: string; label: string; cell: (d: D) => React.ReactNode; right?: boolean; center?: boolean };
  const c = (key: string, label: string, cell: (d: D) => React.ReactNode, opts: Partial<Col> = {}): Col => ({ key, label, cell, right: true, ...opts });
  const costCell = (d: D) => outcome && d.m.spend && d.m[outcome] ? <span className="font-semibold text-brand-strong">{formatMetric("cpl", d.m.spend / d.m[outcome], currency)}</span> : "–";
  const outLabel = attr("resultType") ? "Results" : outcome ? outcomeNoun(outcome).replace(/^./, (x) => x.toUpperCase()) : "Results";

  const cols: Col[] = [
    ...(attr("delivery") ? [c("delivery", "Delivery", (d) => <StatusPill v={d.r.attrs?.delivery} />, { right: false, center: true })] : []),
    ...(attr("budget") ? [c("budget", data.some((d) => /lifetime/i.test(d.r.attrs?.budgetType ?? "")) ? "Budget" : "Daily budget", (d) => {
      const b = d.r.attrs?.budget;
      if (b == null) return "–";
      const t = (d.r.attrs?.budgetType ?? "").toLowerCase();
      // Only label the period when the export says it; never assume daily.
      const per = /daily|day/.test(t) ? " / day" : /lifetime/.test(t) ? " lifetime" : "";
      return `${formatMetric("spend", b, currency, { exact: true })}${per}`;
    })] : []),
    ...(attr("optScore") ? [c("opt", "Optimisation score", (d) => d.r.attrs?.optScore != null ? <span className="text-brand-strong">{d.r.attrs.optScore.toFixed(2)}%</span> : "–")] : []),
    ...(has("reach") ? [c("reach", "Reach", (d) => formatMetric("reach", d.m.reach, currency))] : []),
    ...(clicks ? [c("clicks", "Clicks", (d) => formatMetric("clicks", d.m.clicks, currency))] : []),
    ...(has("impressions") ? [c("impr", "Impressions", (d) => <span className="text-ink-2">{formatMetric("impressions", d.m.impressions, currency)}</span>)] : []),
    ...(has("reach") ? [c("freq", "Frequency", (d) => d.m.reach && d.m.impressions ? (d.m.impressions / d.m.reach).toFixed(2) : "–")] : []),
    ...(clicks ? [
      c("ctr", "CTR", (d) => <span className="text-good">{formatMetric("ctr", d.m.ctr, currency)}</span>),
      c("cpc", "Avg CPC", (d) => formatMetric("cpc", d.m.cpc, currency)),
    ] : []),
    ...(attr("resultType") ? [c("rt", "Result type", (d) => <span className="text-ink-2">{d.r.attrs?.resultType ?? "–"}</span>, { right: false, center: true })] : []),
    ...(clicks && has("spend") ? [c("spend", "Total cost", (d) => formatMetric("spend", d.m.spend, currency, { exact: true }))] : []),
    ...(outcome ? [c("out", outLabel, (d) => <strong>{formatMetric(outcome, d.m[outcome], currency)}</strong>)] : []),
    ...(!clicks && has("spend") ? [c("spend", "Amount spent", (d) => formatMetric("spend", d.m.spend, currency, { exact: true }))] : []),
    ...(outcome && has("spend") ? [c("cost", clicks ? `Cost per ${outcomeNoun(outcome, 1)}` : "Cost per result", costCell)] : []),
    ...(outcome && clicks ? [c("cr", outcome === "leads" ? "Lead rate" : "Conv. rate", (d) => d.m.clicks && d.m[outcome] ? <span className="text-good">{formatPercent(d.m[outcome] / d.m.clicks, 2)}</span> : "–")] : []),
  ];
  const what = level === "ad set" ? "ad set" : level;
  return (
    <section className={card}>
      <SectionHead light={`${channel} campaign performance`} bold="breakdown"
        lead={`Every ${what} from the ${channel} export for ${monthLabel(month)}.${level === "ad set" && !has("reach") ? " Reach and frequency show when the export has one line per ad set." : ""}`} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line bg-page/70 text-xs uppercase tracking-wide text-ink-2">
              <th className="px-3 py-3 text-left font-semibold">{withParent ? "Campaign & ad set name" : level === "campaign" ? "Campaign name" : level === "ad set" ? "Ad set name" : "Ad name"}</th>
              {cols.map((col) => <th key={col.key} className={`px-3 py-3 font-semibold ${col.right ? "text-right" : col.center ? "text-center" : "text-left"}`}>{col.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.r.label} className="border-b border-line-soft last:border-0">
                <th scope="row" className="max-w-[260px] px-3 py-4 text-left align-middle font-semibold">
                  {withParent && d.r.attrs?.parent ? (<>{d.r.attrs.parent}<span className="mt-0.5 block font-normal text-ink-3">{d.r.label}</span></>) : d.r.label}
                </th>
                {cols.map((col) => <td key={col.key} className={`whitespace-nowrap px-3 py-4 ${col.right ? "text-right" : col.center ? "text-center" : ""}`}>{col.cell(d)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({ v }: { v?: string }) {
  if (!v) return <span className="text-ink-3">–</span>;
  const on = /active|enabled|eligible|delivering/i.test(v);
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-good-soft text-good" : "bg-line-soft text-ink-2"}`}>{v.charAt(0).toUpperCase() + v.slice(1)}</span>;
}

/* ================= goals ================= */

export function goalActual(g: Goal, m: MonthData | undefined): number | null {
  if (!m) return null;
  if (g.metric) return m.totals[g.metric] ?? null;
  return m.goalActuals[g.id] ?? null;
}

/** Progress towards a goal: 0..1+ for "at least" goals; for "at most" goals 1 means on or under target. */
function progress(g: Goal, actual: number | null) {
  if (actual == null || !g.target) return null;
  return g.direction === "atLeast" ? actual / g.target : actual <= g.target ? 1 : g.target / actual;
}

function fmtGoal(g: Goal, v: number | null, currency: string) {
  if (v == null) return "–";
  return g.metric ? formatMetric(g.metric, v, currency) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v).replace(/,/g, "\u00a0");
}

export function GoalsSection({ goals, months, selected, currency }: { goals: Goal[]; months: MonthData[]; selected: string; currency: string }) {
  const w = useWords();
  const idx = months.findIndex((m) => m.month === selected);
  const month = months[idx];
  const prev = idx > 0 ? months[idx - 1] : undefined;
  if (!goals.length) return null;
  return (
    <section className={card}>
      <SectionHead light="Goals" bold={`for ${selected ? monthLabel(selected) : "this month"}`}
        lead={prev ? `Each target compared with ${monthLabel(prev.month)} and ${monthLabel(selected)}.` : `Progress against each ${w.unitly.toLowerCase()} target.`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {goals.map((g) => {
          const now = goalActual(g, month);
          const before = goalActual(g, prev);
          const p = progress(g, now);
          const met = p != null && p >= 1;
          const pct = p == null ? 0 : Math.min(1, p);
          return (
            <div key={g.id} className="rounded-2xl bg-page/70 p-5 ring-1 ring-line">
              <div className="flex items-start justify-between gap-3">
                <h4 className="font-semibold uppercase tracking-wide">{g.label}</h4>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${met ? "bg-good-soft text-good" : "bg-brand-soft text-brand-strong"}`}>
                  {met ? "Target met" : `Target: ${g.direction === "atMost" ? "≤ " : ""}${fmtGoal(g, g.target, currency)}${g.direction === "atLeast" ? w.short : ""}`}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-ink-3">{prev ? monthLabel(prev.month, prev.month.includes("W") ? "short" : "long") : w.last.replace(/^./, (c) => c.toUpperCase())}</p>
                  <p className="num mt-0.5 text-xl">{fmtGoal(g, before, currency)}</p>
                </div>
                <div className="text-right">
                  <p className="text-ink-3">{monthLabel(selected)}</p>
                  <p className="num mt-0.5 text-xl">{fmtGoal(g, now, currency)}</p>
                </div>
              </div>
              <div className="mt-4 h-2.5 rounded-full bg-line" role="img" aria-label={p == null ? "No figure yet" : `${Math.round(Math.min(p, 9.99) * 100)}% of target`}>
                <div className="grow h-2.5 rounded-full" style={{ width: `${pct * 100}%`, background: met ? "var(--color-good)" : "var(--color-brand)" }} />
              </div>
              <p className="mt-2 text-sm text-ink-2">
                {p == null ? "No figure for this month yet."
                  : g.direction === "atMost" ? (met ? "Within target." : `${formatPercent(now! / g.target - 1, 0)} above target.`)
                  : met ? `${Math.round(p * 100)}% of target achieved.` : `${Math.round(p * 100)}% of target achieved in ${periodName(selected, false)}.`}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ================= roadmap ================= */

export function Roadmap({ milestones }: { milestones: Milestone[] }) {
  if (!milestones.length) return null;
  const color = { done: "var(--color-good)", current: "var(--color-brand)", upcoming: "var(--color-ink-3)" } as const;
  return (
    <section className={card}>
      <SectionHead light="Project" bold="roadmap" />
      <ol className="relative grid gap-8 border-l-2 border-line pl-8 md:mx-auto md:max-w-4xl">
        {milestones.map((m, i) => (
          <li key={m.id} className="relative">
            <span className="num absolute -left-[47px] top-0 grid size-8 place-items-center rounded-full text-sm text-white ring-4 ring-surface" style={{ background: color[m.status] }}>
              {m.status === "done" ? "✓" : i + 1}
            </span>
            <p className="font-semibold">{m.title}</p>
            <p className="text-sm font-medium" style={{ color: color[m.status] }}>
              {m.when}{m.status === "current" ? " (in progress)" : m.status === "upcoming" ? " (planned)" : ""}
            </p>
            {m.description && <p className="mt-1.5 max-w-2xl leading-relaxed text-ink-2">{m.description}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ================= ROI scenario planner ================= */

export function RoiPlanner({ month, currency, roi }: {
  month: MonthData | undefined;
  currency: string;
  roi?: { saleNoun: string; avgSaleValue: number | null; rate: number | null } | null;
}) {
  const w = useWords();
  const t = month?.totals ?? {};
  const outcome = outcomeMetric(t) ?? "leads";
  const noun = outcomeNoun(outcome);
  const one = outcomeNoun(outcome, 1);
  const currentCost = (outcome === "leads" ? t.cpl : outcome === "conversions" ? t.cpa : undefined) ?? (t.spend && t[outcome] ? t.spend / t[outcome] : 60);
  const saleNoun = roi?.saleNoun || "sales";
  const start = {
    budget: Math.round(t.spend || 20000),
    cost: Math.max(1, Math.round(currentCost * 100) / 100),
    rate: roi?.rate ?? 1,
    value: roi?.avgSaleValue ?? (t.revenue && t.conversions ? Math.round(t.revenue / t.conversions) : 10000),
  };
  const [v, setV] = useState(start);
  const ranges = useMemo(() => ({
    budget: [Math.max(1000, Math.round(start.budget * 0.2)), Math.round(start.budget * 4) || 100000],
    cost: [Math.max(1, Math.round(start.cost * 0.3)), Math.max(10, Math.round(start.cost * 4))],
    rate: [0.1, Math.max(10, start.rate * 3)],
    value: [Math.max(100, Math.round(start.value * 0.3)), Math.max(1000, Math.round(start.value * 3))],
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const leads = v.cost > 0 ? v.budget / v.cost : 0;
  const sales = leads * (v.rate / 100);
  const revenue = sales * v.value;
  const roas = v.budget ? revenue / v.budget : 0;
  const money = (n: number) => formatMetric("revenue", n, currency).replace(/\.00$/, "");
  const fmtN = (n: number, d = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(n).replace(/,/g, "\u00a0");

  const slider = (key: keyof typeof v, label: string, display: string, step: number) => (
    <label className="grid gap-2">
      <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
        {label}<span className="num text-brand-strong">{display}</span>
      </span>
      <input type="range" className="accent-[var(--color-brand)]" min={ranges[key][0]} max={ranges[key][1]} step={step} value={v[key]}
        onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })} />
      <span className="flex justify-between text-xs text-ink-3">
        <span>{key === "rate" ? `${ranges[key][0]}%` : money(ranges[key][0])}</span>
        <span>{key === "rate" ? `${fmtN(ranges[key][1], 1)}%` : money(ranges[key][1])}</span>
      </span>
    </label>
  );

  return (
    <section className="grid grid-cols-1 gap-6">
      <div className={card}>
        <SectionHead light="ROI" bold="scenario planner"
          lead={`Move the sliders to see what a different budget or cost per ${one} could deliver. It starts from ${month ? monthLabel(month.month) : "your latest"} figures.`} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className={`${card} grid gap-6 lg:col-span-2`}>
          <h4 className="font-semibold uppercase tracking-wide">Your assumptions</h4>
          {slider("budget", `${w.unitly} budget`, money(v.budget), 500)}
          {slider("cost", `Cost per ${one}`, money(v.cost), 0.5)}
          {slider("rate", `${one.replace(/^./, (c) => c.toUpperCase())} to ${saleNoun.replace(/s$/, "")} rate`, `${fmtN(v.rate, 1)}%`, 0.1)}
          {slider("value", `Average ${saleNoun.replace(/s$/, "")} value`, money(v.value), Math.max(1, Math.round(start.value / 200)))}
          <button type="button" className="justify-self-start text-sm font-medium text-brand-strong hover:underline print:hidden" onClick={() => setV(start)}>Reset to this month’s figures</button>
        </div>
        <div className="rounded-3xl bg-night p-6 text-white sm:p-8 lg:col-span-3">
          <h4 className="font-semibold uppercase tracking-wide text-white/70">Projected <span className="text-brand">outcomes</span></h4>
          <div className="mt-6 grid gap-8 sm:grid-cols-2 [&>*]:min-w-0">
            <Out label={`${noun.replace(/^./, (c) => c.toUpperCase())} ${w.perUnit}`} value={fmtN(leads)} sub={`Budget ÷ cost per ${one}`} />
            <Out label={`${saleNoun.replace(/^./, (c) => c.toUpperCase())} ${w.perUnit}`} value={fmtN(sales, 1)} sub={`${noun.replace(/^./, (c) => c.toUpperCase())} × ${fmtN(v.rate, 1)}%`} />
            <Out label="Sales value" value={revenue >= 1_000_000 ? formatMetric("revenue", revenue, currency, { compact: true }) : money(revenue)} sub={`${saleNoun.replace(/^./, (c) => c.toUpperCase())} × average value`} accent="good" />
            <Out label="Return on ad spend" value={`${fmtN(roas, 1)}×`} sub="Sales value ÷ budget" accent="brand" />
          </div>
          <p className="mt-8 rounded-2xl bg-white/[0.06] p-4 text-sm leading-relaxed text-white/80 ring-1 ring-white/10">
            At {money(v.budget)} a {w.unit} and {money(v.cost)} per {one}, you’d expect about {fmtN(leads)} {noun}. If {fmtN(v.rate, 1)}% become {saleNoun},
            that’s about {fmtN(sales, 1)} {saleNoun} worth {money(revenue)}. These are estimates to help plan budgets, not promises: real results move with
            the market, the season and the creative.
          </p>
        </div>
      </div>
    </section>
  );
}

function Out({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: "good" | "brand" }) {
  return (
    <div>
      <p className="text-sm text-white/60">{label}</p>
      <p className={`num mt-1 break-words text-[clamp(1.75rem,1.2rem+1.6vw,2.6rem)] leading-none ${accent === "good" ? "text-[#7ee2bd]" : accent === "brand" ? "text-brand" : "text-white"}`}>{value}</p>
      <p className="mt-1.5 text-xs text-white/50">{sub}</p>
    </div>
  );
}

export { metricDef };

/* ================= sales figures (entered by hand) ================= */


export function SalesSection({ sales, month, currency, kind = "month" }: { sales?: Record<string, SalesSnapshot>; month: string; currency: string; kind?: "month" | "week" }) {
  // Sales figures of the report's own period; a weekly view without weekly figures falls back to the month's.
  let snap = snapshotFor(sales, month, kind);
  let fallback = false;
  if (!snap && kind === "week") {
    snap = snapshotFor(sales, month ? monthOfPeriod(month) : "", "month");
    fallback = !!snap;
  }
  if (!snap) {
    return (
      <section className={card}>
        <SectionHead light="Sales" bold={month ? `for ${monthLabel(month)}` : "figures"} lead="No sales figures have been uploaded for this period yet." />
      </section>
    );
  }
  const prev = previousSnapshot(sales, snap.month);
  const { total, available, committed } = summarize(snap.rows);
  const money = (v: number | null) => (v == null ? "–" : formatMetric("revenue", v, currency).replace(/\.00$/, ""));
  const pct = (v: number | null, t: number | null) => (v == null || !t ? "–" : formatPercent(v / t, 0));
  const area = (v: number | null) => (v == null ? "–" : <>{new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v).replace(/,/g, "\u00a0")} m<sup>2</sup></>);
  const hasValue = total.value != null;
  const hasSize = total.size != null;
  const changes = prev
    ? snap.rows.map((r) => {
        const before = prev.rows.find((p) => p.status.toLowerCase() === r.status.toLowerCase())?.units ?? 0;
        return { status: r.status, d: r.units - before };
      }).filter((c) => c.d !== 0)
    : [];
  const tiles = [
    { label: "Total units", value: String(total.units), sub: hasValue ? `${money(total.value)} portfolio value` : "In this development" },
    ...(committed ? [{ label: "Committed units", value: String(committed.units), sub: hasValue ? `${money(committed.value)} secured` : "Reserved, sold and further along", good: true }] : []),
    ...(available ? [{ label: "Still available", value: String(available.units), sub: hasValue ? `${money(available.value)} to sell` : `${pct(available.units, total.units)} of all units` }] : []),
    ...(committed && total.units ? [{ label: "Sold or committed", value: formatPercent(committed.units / total.units, 0), sub: "Of all units" }] : []),
  ];
  return (
    <div className="grid grid-cols-1 gap-6">
      <section aria-label="Sales summary" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl bg-surface p-5 ring-1 ring-line">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t.label}</p>
            <p className={`num mt-2 text-[1.9rem] leading-none ${"good" in t && t.good ? "text-good" : "text-ink"}`}>{t.value}</p>
            <p className="mt-2 text-sm text-ink-2">{t.sub}</p>
          </div>
        ))}
      </section>

      <section className={card}>
        <SectionHead light="Sales" bold={`as at ${monthLabel(snap.month)}`}
          lead={fallback ? `No weekly sales figures have been uploaded, so these are the latest monthly figures, from ${monthLabel(snap.month)}.`
            : month && snap.month !== month ? `The latest sales figures, from ${monthLabel(snap.month)}.` : "Units, value and size by status."} />
        <div className="grid min-w-0 grid-cols-1 gap-8 min-[1700px]:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)] min-[1700px]:items-center">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-[3px] text-sm">
              <thead>
                <tr className="text-white">
                  <th />
                  <th colSpan={2} className="rounded-md bg-ink-3 px-3 py-2 font-semibold">Units</th>
                  {hasValue && <th colSpan={2} className="rounded-md bg-ink-3 px-3 py-2 font-semibold">Value</th>}
                  {hasSize && <th colSpan={2} className="rounded-md bg-ink-3 px-3 py-2 font-semibold">Size</th>}
                </tr>
              </thead>
              <tbody>
                {snap.rows.map((r, i) => (
                  <tr key={r.status} className="bg-line-soft">
                    <th scope="row" className="rounded-l-md px-4 py-2.5 text-left text-base font-semibold" style={{ color: statusColor(r.status, i) }}>{r.status}</th>
                    <td className="num px-3 py-2.5 text-right">{r.units}</td>
                    <td className="px-3 py-2.5 text-right">{pct(r.units, total.units)}</td>
                    {hasValue && <><td className="num px-3 py-2.5 text-right">{money(r.value)}</td><td className="px-3 py-2.5 text-right">{pct(r.value, total.value)}</td></>}
                    {hasSize && <><td className="num px-3 py-2.5 text-right">{area(r.size)}</td><td className="rounded-r-md px-3 py-2.5 text-right">{pct(r.size, total.size)}</td></>}
                  </tr>
                ))}
                <tr className="bg-line font-semibold">
                  <th scope="row" className="rounded-l-md px-4 py-2.5 text-left">Total</th>
                  <td className="num px-3 py-2.5 text-right">{total.units}</td>
                  <td className="px-3 py-2.5 text-right">100%</td>
                  {hasValue && <><td className="num px-3 py-2.5 text-right">{money(total.value)}</td><td className="px-3 py-2.5 text-right">100%</td></>}
                  {hasSize && <><td className="num px-3 py-2.5 text-right">{area(total.size)}</td><td className="rounded-r-md px-3 py-2.5 text-right">100%</td></>}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="min-w-0 max-w-xl">
            <h4 className="mb-4 font-semibold">Units by status</h4>
            <SalesDonut rows={snap.rows} total={total.units} />
          </div>
        </div>
        {prev && (
          <p className="mt-6 text-sm text-ink-2">
            <strong className="text-ink">Since {monthLabel(prev.month)}:</strong>{" "}
            {changes.length ? changes.map((c) => `${c.status} ${c.d > 0 ? "+" : "−"}${Math.abs(c.d)} unit${Math.abs(c.d) === 1 ? "" : "s"}`).join(", ") : "no change in unit numbers"}.
          </p>
        )}
      </section>
      <CommentBox text={snap.comment} about={monthLabel(snap.month)} />
    </div>
  );
}

/** Donut in the status colours (the shared Donut uses brand colours, so colours are applied by order). */
function SalesDonut({ rows, total }: { rows: { status: string; units: number }[]; total: number }) {
  const data = rows.map((r) => ({ name: r.status, value: r.units }));
  return (
    <div>
      <Donut data={data} format={(v) => `${v} unit${v === 1 ? "" : "s"}`} centerValue={String(total)} centerLabel="units"
        colors={rows.map((r, i) => statusColor(r.status, i))} />
    </div>
  );
}

/* ================= branches of a listing ================= */

export function BranchSection({ rows, channel, month, currency }: { rows: BreakdownRow[]; channel: string; month: string; currency: string }) {
  const totals = rows.reduce<Record<string, number>>((t, r) => { for (const [k, v] of Object.entries(r.metrics)) t[k] = (t[k] ?? 0) + v; return t; }, {});
  const outcome = outcomeMetric(totals);
  if (!outcome) return null;
  const others = ["leads", "landing_page_views", "spend"].filter((k) => k !== outcome && rows.some((r) => r.metrics[k] != null));
  const total = totals[outcome] ?? 0;
  const noun = outcomeNoun(outcome);
  const top = [...rows].sort((a, b) => (b.metrics[outcome] ?? 0) - (a.metrics[outcome] ?? 0))[0];
  return (
    <section className={card}>
      <SectionHead light={channel} bold="by branch"
        lead={total && top ? `${top.label} brought the most ${noun} in ${monthLabel(month)}: ${formatPercent((top.metrics[outcome] ?? 0) / total, 0)} of ${channel}’s ${formatMetric(outcome, total, currency)}.` : undefined} />
      <div className="grid min-w-0 grid-cols-1 gap-8 min-[1500px]:grid-cols-[minmax(420px,1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 max-w-xl">
          <Donut data={rows.map((r) => ({ name: r.label, value: r.metrics[outcome] ?? 0 }))} format={(v) => `${formatMetric(outcome, v, currency)} ${outcomeNoun(outcome, v)}`}
            centerValue={formatMetric(outcome, total, currency, { compact: true })} centerLabel={noun} />
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line bg-page/70 text-xs uppercase tracking-wide text-ink-2">
                <th className="px-3 py-2.5 text-left font-semibold">Branch</th>
                <th className="px-3 py-2.5 text-right font-semibold">{noun}</th>
                <th className="px-3 py-2.5 text-right font-semibold">Share</th>
                {others.map((k) => <th key={k} className="px-3 py-2.5 text-right font-semibold">{metricDef(k).label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line-soft">
                  <th scope="row" className="px-3 py-2.5 text-left font-medium">{r.label}</th>
                  <td className="num px-3 py-2.5 text-right">{formatMetric(outcome, r.metrics[outcome] ?? 0, currency)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{total ? formatPercent((r.metrics[outcome] ?? 0) / total, 0) : "–"}</td>
                  {others.map((k) => <td key={k} className="px-3 py-2.5 text-right">{r.metrics[k] != null ? formatMetric(k, r.metrics[k], currency) : "–"}</td>)}
                </tr>
              ))}
              <tr className="font-semibold">
                <th scope="row" className="px-3 py-2.5 text-left">Total</th>
                <td className="num px-3 py-2.5 text-right">{formatMetric(outcome, total, currency)}</td>
                <td className="px-3 py-2.5 text-right">100%</td>
                {others.map((k) => <td key={k} className="px-3 py-2.5 text-right">{totals[k] != null ? formatMetric(k, totals[k], currency) : "–"}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** A comment from the Aimex team, shown with sales or room sales figures. */
function CommentBox({ text, about }: { text?: string | null; about: string }) {
  if (!text?.trim()) return null;
  return (
    <section aria-label="Comments" className="rounded-3xl border-l-4 border-brand bg-surface p-6 ring-1 ring-line sm:p-8">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Comments <span className="font-normal normal-case tracking-normal text-ink-3">on {about}</span></h3>
      <p className="mt-2 max-w-4xl whitespace-pre-line leading-relaxed text-ink">{text}</p>
    </section>
  );
}

/* ================= Spectrum Collection: room sales ================= */

export function RoomSalesSection({ snapshots, currency }: { snapshots?: Record<string, RoomSnapshot>; currency: string }) {
  const dates = Object.keys(snapshots ?? {}).sort();
  const [at, setAt] = useState(dates.at(-1) ?? "");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  if (!dates.length) {
    return (
      <section className={card}>
        <SectionHead light="Room" bold="sales" lead="No room sales report has been uploaded yet." />
      </section>
    );
  }

  const all = snapshots!;
  const snap = all[at] ?? all[dates.at(-1)!];
  const { current, ahead, earlier } = roomOutlook(all, snap.reportDate);
  const series = paceSeries(all, snap.reportDate);

  const money = (v: number) => formatMetric("revenue", v, currency).replace(/\.00$/, "");
  const n = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v).replace(/,/g, "\u00a0");
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const signed = (v: number, f: (x: number) => string) => `${v >= 0 ? "+" : "−"}${f(Math.abs(v))}`;
  const dayLabel = (iso: string) => {
    const [, mo, dd] = iso.split("-");
    return `${+dd} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mo - 1]}`;
  };
  const fullDate = (iso: string) => `${dayLabel(iso)} ${iso.slice(0, 4)}`;
  const mName = (m: string) => monthLabel(m).split(" ")[0];
  const rooms = (k: number) => (Math.abs(k) === 1 ? "room" : "rooms");
  const pickupText = (m: MonthOutlook) => m.pickup == null ? null : `${signed(m.pickup, n)} ${rooms(m.pickup)} since ${dayLabel(m.previousDate!)}`;
  const daysLeft = current ? Math.max(0, Math.round(current.weeksLeft * 7)) : 0;
  const rows = [...earlier, ...ahead];
  const hasBudget = [current, ...rows].some((m) => m?.budget != null);

  // The hotel's keys: rooms available each night, from the monthly figures (rooms available ÷ nights in the month)
  const dailyRooms = (current ?? rows[0])?.keys ?? 0;

  // Month lead narrative
  const lead = [
    current ? `${mName(current.month)} is ${pct(current.occ)} booked with ${daysLeft} ${daysLeft === 1 ? "night" : "nights"} to go` : null,
    ahead.length ? `${ahead.map((m) => `${mName(m.month)} ${pct(m.occ)}`).join(" and ")} on the books so far` : null,
  ].filter(Boolean).join("; ") + ".";

  // Budget from the uploaded file's budget column; the tiles show only when this month has one
  const budget = current?.budget ?? null;
  const totalRevenue = current?.revenue ?? 0;
  const variance = budget == null ? null : totalRevenue - budget; // stayed + booked vs budget
  const split = current ? monthSplit(snap) : null;
  const rangeLabel = (a: string, b: string) => (a === b ? dayLabel(a) : a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8)}–${dayLabel(b)}` : `${dayLabel(a)} – ${dayLabel(b)}`);

  // Primary Dashboard Tiles (ADR and RevPAR removed, Daily rooms clarified, Total Rev and Variance added)
  const tiles = current ? [
    {
      label: "Occupancy",
      value: pct(current.occ),
      sub: `${mName(current.month)}, as at ${dayLabel(snap.reportDate)}`,
      extra: pickupText(current)
    },
    // Revenue split into nights already stayed and nights booked ahead, when the daily rows allow it.
    ...(split ? [
      {
        label: "Revenue so far",
        value: money(split.stayedRevenue),
        sub: split.stayedTo
          ? `${n(split.stayedRooms)} room ${split.stayedRooms === 1 ? "night" : "nights"} stayed, ${rangeLabel(split.stayedFrom, split.stayedTo)}`
          : "No nights stayed yet this month",
        extra: null
      },
      {
        label: "Booked, not yet stayed",
        value: split.aheadRevenue >= 1_000_000 ? `R ${(split.aheadRevenue / 1_000_000).toFixed(2)}m` : money(split.aheadRevenue),
        sub: `${n(split.aheadRooms)} room ${split.aheadRooms === 1 ? "night" : "nights"} booked, ${rangeLabel(split.aheadFrom, split.aheadTo)}`,
        extra: current.pickupRevenue == null ? null : `${signed(current.pickupRevenue, money)} since ${dayLabel(current.previousDate!)}`
      },
    ] : [
      {
        label: "Revenue on the books",
        value: totalRevenue >= 1_000_000 ? `R ${(totalRevenue / 1_000_000).toFixed(2)}m` : money(totalRevenue),
        sub: `Stayed and booked for ${mName(current.month)} (no daily figures to split it)`,
        extra: current.pickupRevenue == null ? null : `${signed(current.pickupRevenue, money)} since ${dayLabel(current.previousDate!)}`
      },
    ]),
    ...(budget != null && variance != null ? [
      {
        label: "Monthly Budget",
        value: money(budget),
        sub: `Target for ${mName(current.month)}`,
        extra: null
      },
      {
        label: "Budget Variance",
        value: `${signed(variance, money)}`,
        sub: variance >= 0 ? "Stayed + booked, ahead of budget" : "Stayed + booked, short of budget",
        extra: variance >= 0 ? "On track" : "Pace required",
        isPositive: variance >= 0
      },
    ] : []),
  ] as { label: string; value: string; sub: string; extra: string | null; isPositive?: boolean }[] : [];

  // Daily chart verification
  const showDaily = dailyMatches(snap);
  const allDays = snap.days ?? [];
  const dayMonths = [...new Set(allDays.map((d) => d.date.slice(0, 7)))];
  const firstDay = allDays[0]?.date ?? snap.reportDate;
  const lastDay = allDays.at(-1)?.date ?? snap.reportDate;
  const clamp = (d: string) => (d < firstDay ? firstDay : d > lastDay ? lastDay : d);
  const thisWeek = { from: clamp(mondayOf(snap.reportDate)), to: clamp(addDays(mondayOf(snap.reportDate), 6)) };
  const view = range ?? thisWeek;
  const span = Math.round((Date.parse(view.to) - Date.parse(view.from)) / 864e5) + 1;
  const shift = (dir: 1 | -1) => {
    const from = addDays(view.from, dir * span);
    if (from > lastDay || addDays(from, span - 1) < firstDay) return;
    setRange({ from: clamp(from), to: clamp(addDays(from, span - 1)) });
  };
  const presets: { label: string; from: string; to: string }[] = [
    { label: "This week", ...thisWeek },
    { label: "Next week", from: clamp(addDays(mondayOf(snap.reportDate), 7)), to: clamp(addDays(mondayOf(snap.reportDate), 13)) },
    { label: "Next 4 weeks", from: clamp(mondayOf(snap.reportDate)), to: clamp(addDays(mondayOf(snap.reportDate), 27)) },
    ...dayMonths.map((m) => ({ label: monthLabel(m, "short"), from: clamp(`${m}-01`), to: clamp(addDays(`${m.slice(0, 4)}-${String(+m.slice(5, 7) % 12 + 1).padStart(2, "0")}-01`.replace(/^(\d{4})-01-01$/, (_, y) => `${+y + 1}-01-01`), -1)) })),
    { label: "All days", from: firstDay, to: lastDay },
  ];
  const shown = allDays.filter((d) => d.date >= view.from && d.date <= view.to);
  const sel = shown.reduce((t, d) => ({ otb: t.otb + d.otb, available: t.available + d.available, revenue: t.revenue + d.revenue }), { otb: 0, available: 0, revenue: 0 });
  const selRates = roomRates(sel);
  const shortSpan = span <= 14;
  const weekday = (iso: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${iso}T00:00:00Z`).getUTCDay()];
  const ahead7 = weeksAhead(all, snap.reportDate);
  const weekData = ahead7.weeks.map((w) => ({ ...w, occPct: Math.round(w.occ * 1000) / 10, prevPct: w.prevOcc == null ? null : Math.round(w.prevOcc * 1000) / 10 }));
  const hasPrevWeeks = weekData.some((w) => w.prevPct != null);
  const monthBars = [...(current ? [current] : []), ...rows].map((m) => ({ month: m.month, occPct: Math.round(m.occ * 1000) / 10, prevPct: m.pickup == null ? null : Math.round((m.otb - m.pickup) / m.available * 1000) / 10 }));
  const chartData = shown.map((d) => ({
    date: d.date,
    occ: Math.round(roomRates(d).occ * 1000) / 10,
    otb: d.otb,
    available: d.available,
    revenue: d.revenue,
    focus: d.focus ?? "",
    rate: d.rateAction ?? "",
    sales: d.salesAction ?? ""
  }));
  const upcoming = shown;
  const counts = (["GREEN", "AMBER", "RED"] as const).map((k) => ({
    k,
    n: upcoming.filter((d) => (d.focus ?? "").toUpperCase().startsWith(k)).length
  }));
  const nameOf = { GREEN: "Protect / yield", AMBER: "Build / watch", RED: "Need demand" } as const;
  const LINE = ["var(--color-night)", "var(--color-brand)", "var(--color-good)", "#7c6fd6", "#2b8cbe", "#8a94a6"];

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* 1. Header & Main Hero Tiles */}
      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHead light="Room sales" bold={`as at ${fullDate(snap.reportDate)}`} lead={lead} />
          {dates.length > 1 && (
            <label className="field w-48 print:hidden">
              <span>Report date</span>
              <select className="input" value={snap.reportDate} onChange={(e) => setAt(e.target.value)}>
                {[...dates].reverse().map((d) => <option key={d} value={d}>{fullDate(d)}</option>)}
              </select>
            </label>
          )}
        </div>

        {current && (
          <>
            <h3 className="mb-3 mt-4 text-sm font-semibold uppercase tracking-wide text-ink-2">
              This month: {monthLabel(current.month)}{dailyRooms ? ` (${dailyRooms} keys)` : ""}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,165px),1fr))] gap-4">
              {tiles.map((t) => (
                <div key={t.label} className="min-w-0 rounded-2xl bg-page/70 p-5 ring-1 ring-line">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t.label}</p>
                  <p className={`num mt-2 whitespace-nowrap text-[clamp(1.3rem,0.85rem+1.1vw,1.8rem)] leading-tight ${
                    t.label === "Budget Variance" ? (t.isPositive ? "text-good" : "text-bad") : ""
                  }`}>
                    {t.value}
                  </p>
                  <p className="mt-2 text-xs text-ink-2">{t.sub}</p>
                  {t.extra && (
                    <p className={`mt-1 text-xs font-medium ${t.isPositive || t.extra.startsWith("+") ? "text-good" : "text-bad"}`}>
                      {t.extra}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* 3-Month Projection Card */}
            <ThreeMonthProjection outlooks={[current, ...ahead]} n={n} pct={pct} money={money} />
          </>
        )}
      </section>

      <CommentBox text={snap.comment} about={`the report as at ${fullDate(snap.reportDate)}`} />

      {/* 2. Months Ahead & Strategy Table */}
      {rows.length > 0 && (
        <section className={card}>
          <SectionHead
            light={`${rows.length + (current ? 1 : 0)}-Month`}
            bold="Outlook & Pace"
            lead="Detailed forward forecast including pacing and commercial targets per month."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line bg-page/70 text-left text-xs uppercase tracking-wide text-ink-2">
                  <th className="px-3 py-2.5 font-semibold">Month</th>
                  <th className="px-3 py-2.5 text-right font-semibold">OTB Nights</th>
                  <th className="px-3 py-2.5 font-semibold">Occupancy</th>
                  <th className="px-3 py-2.5 text-right font-semibold">OTB Revenue</th>
                  {hasBudget && <th className="px-3 py-2.5 text-right font-semibold">Budget</th>}
                  <th className="px-3 py-2.5 text-right font-semibold">Pickup</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Pace / week</th>
                  <th className="px-3 py-2.5 font-semibold">Projected Month End</th>
                </tr>
              </thead>
              {rows.map((m) => {
                const plan = [
                  m.priority && ["Priority", m.priority],
                  m.rate && ["Rate Strategy", m.rate],
                  m.action && ["Sales / Marketing", m.action],
                  m.driver && ["Demand Driver", m.driver]
                ].filter(Boolean) as [string, string][];

                return (
                  <tbody key={m.month} className="border-b border-line last:border-0">
                    <tr>
                      <th scope="row" className="whitespace-nowrap px-3 pb-1.5 pt-3.5 text-left font-semibold">{monthLabel(m.month)}</th>
                      <td className="whitespace-nowrap px-3 pb-1.5 pt-3.5 text-right">
                        <strong>{n(m.otb)}</strong>
                        <span className="text-ink-3 text-xs"> ({m.keys}/day)</span>
                      </td>
                      <td className="px-3 pb-1.5 pt-3.5"><Occ v={m.occ} pct={pct} /></td>
                      <td className="whitespace-nowrap px-3 pb-1.5 pt-3.5 text-right font-medium">{money(m.revenue)}</td>
                      {hasBudget && (
                        <td className="whitespace-nowrap px-3 pb-1.5 pt-3.5 text-right">
                          {m.budget == null ? <span className="text-ink-3">–</span> : (
                            <>{money(m.budget)}<span className={`block text-xs font-medium ${m.revenue >= m.budget ? "text-good" : "text-bad"}`}>{signed(m.revenue - m.budget, money)}</span></>
                          )}
                        </td>
                      )}
                      <td className={`whitespace-nowrap px-3 pb-1.5 pt-3.5 text-right font-medium ${m.pickup == null ? "text-ink-3" : m.pickup >= 0 ? "text-good" : "text-bad"}`}>
                        {m.pickup == null ? "–" : signed(m.pickup, n)}
                      </td>
                      <td className="whitespace-nowrap px-3 pb-1.5 pt-3.5 text-right">
                        {m.pace == null ? <span className="text-ink-3">–</span> : `${signed(Math.round(m.pace * 10) / 10, (x) => String(x))} ${rooms(Math.round(m.pace * 10) / 10)}`}
                      </td>
                      <td className="whitespace-nowrap px-3 pb-1.5 pt-3.5">
                        {m.projectedRooms == null ? (
                          <span className="text-ink-3 text-xs">Pace pending 2nd upload</span>
                        ) : (
                          <>
                            <strong>{pct(m.projectedOcc!)}</strong>
                            <span className="text-ink-3 text-xs"> · {money(m.projectedRevenue!)}</span>
                          </>
                        )}
                      </td>
                    </tr>
                    {plan.length > 0 && (
                      <tr>
                        <td colSpan={hasBudget ? 8 : 7} className="px-3 pb-3.5">
                          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                            {plan.map(([k, v]) => (
                              <div key={k} className="flex gap-1.5">
                                <dt className="text-ink-3">{k}:</dt>
                                <dd className={k === "Priority" ? "font-semibold text-brand" : "text-ink-2"}>{v}</dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        </section>
      )}

      {/* 3. Booking pace: each week ahead, and each month across uploads */}
      <section className={card}>
        <SectionHead
          light="Booking"
          bold="pace"
          lead={weekData.length
            ? `Occupancy on the books for each week ahead (Monday to Sunday)${hasPrevWeeks ? `, compared with the report as at ${fullDate(ahead7.previousDate!)}` : ""}.`
            : `Occupancy on the books for each month${monthBars.some((m) => m.prevPct != null) ? ", compared with the previous report" : ""}.`}
        />
        {weekData.length > 0 ? (
          <>
            <div className="h-64 w-full" role="img" aria-label={weekData.map((w) => `Week of ${dayLabel(w.week)}: ${w.occPct}%${w.prevPct != null ? ` (was ${w.prevPct}%)` : ""}`).join(", ")}>
              <ResponsiveContainer>
                <BarChart data={weekData} margin={{ top: 16, right: 8, bottom: 0, left: -12 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="week" tickFormatter={dayLabel} interval="preserveStartEnd" minTickGap={16} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const w = payload[0].payload as (typeof weekData)[number];
                    return (
                      <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-lg ring-1 ring-line">
                        <p className="font-semibold">{dayLabel(w.week)} – {fullDate(addDays(w.week, 6))}</p>
                        <p>{n(w.otb)} of {n(w.available)} room nights ({w.occPct}%)</p>
                        <p>{money(w.revenue)}</p>
                        {w.pickup != null && <p className={w.pickup >= 0 ? "text-good" : "text-bad"}>{signed(w.pickup, n)} {rooms(w.pickup)} since {dayLabel(ahead7.previousDate!)}</p>}
                      </div>
                    );
                  }} />
                  {hasPrevWeeks && <Bar dataKey="prevPct" name="Previous report" fill="var(--color-line)" radius={[3, 3, 0, 0]} isAnimationActive={false} />}
                  <Bar dataKey="occPct" name="This report" fill="var(--color-night)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
              <span className="flex items-center gap-2"><span className="size-3 rounded-sm bg-night" />As at {dayLabel(snap.reportDate)}</span>
              {hasPrevWeeks && <span className="flex items-center gap-2"><span className="size-3 rounded-sm bg-line" />As at {dayLabel(ahead7.previousDate!)}</span>}
              {!hasPrevWeeks && <span className="text-ink-3">Next week’s upload adds a comparison with this report.</span>}
            </div>
          </>
        ) : (
          <div className="h-56 w-full" role="img" aria-label={monthBars.map((m) => `${monthLabel(m.month)}: ${m.occPct}%`).join(", ")}>
            <ResponsiveContainer>
              <BarChart data={monthBars} margin={{ top: 16, right: 8, bottom: 0, left: -12 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="month" tickFormatter={(m) => monthLabel(String(m), "short")} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v, k) => [`${v}%`, k === "prevPct" ? "Previous report" : "This report"]} labelFormatter={(m) => monthLabel(String(m))} />
                {monthBars.some((m) => m.prevPct != null) && <Bar dataKey="prevPct" fill="var(--color-line)" radius={[3, 3, 0, 0]} isAnimationActive={false} />}
                <Bar dataKey="occPct" fill="var(--color-night)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {series.points.length > 1 && (<>
          <h4 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-3">Each month across the last {series.points.length} reports</h4>
          <div className="h-56 w-full" role="img" aria-label={series.months.map((m) => `${monthLabel(m)}: ${series.points.map((p) => `${dayLabel(p.date)} ${(p as Record<string, unknown>)[m] ?? "–"}%`).join(", ")}`).join("; ")}>
            <ResponsiveContainer>
              <LineChart data={series.points} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(d) => `Report as at ${fullDate(String(d))}`} formatter={(v, k) => [`${v}%`, monthLabel(String(k))]} />
                {series.months.map((m, i) => (
                  <Line key={m} dataKey={m} name={m} stroke={LINE[i % LINE.length]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
            {series.months.map((m, i) => <span key={m} className="flex items-center gap-2"><span className="h-0.5 w-4 rounded" style={{ background: LINE[i % LINE.length] }} />{monthLabel(m)}</span>)}
          </div>
        </>)}
      </section>

      {/* 4. Daily Occupancy Chart */}
      {allDays.length > 0 && (showDaily ? (
        <section className={card}>
          <SectionHead
            light="Daily Inventory"
            bold="& Focus"
            lead={`Tracking each day's ${dailyRooms} available rooms.` + (upcoming.length ? ` In this range: ${counts.map((c) => `${c.n} ${nameOf[c.k].toLowerCase()} day${c.n === 1 ? "" : "s"}`).join(", ")}.` : "")}
          />
          <div className="mb-4 grid gap-3 print:hidden">
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => {
                const on = view.from === p.from && view.to === p.to;
                return (
                  <button key={p.label} type="button" onClick={() => setRange({ from: p.from, to: p.to })} aria-pressed={on}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${on ? "bg-night text-white" : "bg-line-soft hover:bg-line"}`}>{p.label}</button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <button type="button" onClick={() => shift(-1)} disabled={view.from <= firstDay} aria-label="Previous period"
                className="grid size-9 place-items-center rounded-lg ring-1 ring-line hover:bg-page disabled:opacity-40">‹</button>
              <label className="field w-40"><span>From</span>
                <input type="date" className="input" value={view.from} min={firstDay} max={lastDay}
                  onChange={(e) => e.target.value && setRange({ from: clamp(e.target.value), to: e.target.value > view.to ? clamp(e.target.value) : view.to })} /></label>
              <label className="field w-40"><span>To</span>
                <input type="date" className="input" value={view.to} min={firstDay} max={lastDay}
                  onChange={(e) => e.target.value && setRange({ from: e.target.value < view.from ? clamp(e.target.value) : view.from, to: clamp(e.target.value) })} /></label>
              <button type="button" onClick={() => shift(1)} disabled={view.to >= lastDay} aria-label="Next period"
                className="grid size-9 place-items-center rounded-lg ring-1 ring-line hover:bg-page disabled:opacity-40">›</button>
            </div>
          </div>
          <p className="mb-3 text-sm text-ink-2">
            <strong className="text-ink">{fullDate(view.from)}{view.to !== view.from ? ` – ${fullDate(view.to)}` : ""}</strong>
            {" · "}{n(sel.otb)} of {n(sel.available)} room nights sold ({pct(selRates.occ)}) · {money(sel.revenue)}{sel.otb ? ` · ADR ${money(selRates.adr)}` : ""}
          </p>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="date" tickFormatter={(d) => (shortSpan ? `${weekday(String(d))} ${dayLabel(String(d))}` : dayLabel(String(d)))} interval={shortSpan ? 0 : "preserveStartEnd"} minTickGap={shortSpan ? 4 : 24} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof chartData)[number];
                  return (
                    <div className="rounded-lg bg-surface px-3 py-2 text-xs shadow-lg ring-1 ring-line">
                      <p className="font-semibold">{fullDate(d.date)}</p>
                      <p>{d.otb} of {d.available} rooms sold ({d.occ}%)</p>
                      <p>{money(d.revenue)}</p>
                      {d.focus && <p className="mt-1 font-medium" style={{ color: focusColor(d.focus) }}>{d.focus}</p>}
                      {d.rate && <p className="text-ink-2">Rate: {d.rate}</p>}
                    </div>
                  );
                }} />
                {view.from < snap.reportDate && view.to >= snap.reportDate && (
                  <ReferenceLine x={snap.reportDate} stroke="var(--color-ink-2)" strokeDasharray="4 3" label={{ value: "Report date", position: "insideTopRight", fontSize: 11, fill: "var(--color-ink-2)" }} />
                )}
                <Bar dataKey="occ" radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                  {chartData.map((d) => (
                    <Cell key={d.date} fill={focusColor(d.focus)} fillOpacity={d.date < snap.reportDate ? 0.45 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
            {counts.map((c) => <span key={c.k} className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: focusColor(c.k) }} />{nameOf[c.k]}</span>)}
            {view.from < snap.reportDate && <span className="text-ink-3">Days before the report date are shown faded.</span>}
          </div>
        </section>
      ) : null)}
    </div>
  );
}

/** Month-end projections for every month in the report, worded as estimates. */
function ThreeMonthProjection({
  outlooks,
  n,
  pct,
  money
}: {
  outlooks: (MonthOutlook | null)[];
  n: (x: number) => string;
  pct: (x: number) => string;
  money: (x: number) => string;
}) {
  const months = outlooks.filter((m): m is MonthOutlook => !!m);
  if (!months.length) return null;
  const hasPace = months.some((m) => m.projectedRooms != null);

  return (
    <div className="mt-5 rounded-2xl border border-line bg-page/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {hasPace ? "Projected month end" : "On the books by month"}
        </h4>
        <span className="text-xs text-ink-3">
          {hasPace ? "At each month’s booking pace of the last four weeks. Estimates, not guarantees." : "Projections start from the second weekly upload."}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
        {months.map((m) => {
          const projected = m.projectedRooms != null;
          const occ = projected ? m.projectedOcc! : m.occ;
          const revenue = projected ? m.projectedRevenue! : m.revenue;
          return (
            <div key={m.month} className="rounded-xl bg-surface p-3 ring-1 ring-line">
              <p className="text-xs font-medium text-ink-2">{monthLabel(m.month)}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-bold">{pct(occ)}</span>
                <span className="text-xs text-ink-3">{projected ? "projected occ" : "on the books"}</span>
              </div>
              <p className="mt-1 text-xs font-medium text-ink-2">{money(revenue)}</p>
              <p className="text-[11px] text-ink-3">
                {projected ? `${n(m.projectedRooms!)} est. room nights` : `${n(m.otb)} room nights on books`}
              </p>
              {m.budget != null && (
                <p className={`mt-1 text-[11px] font-medium ${revenue >= m.budget ? "text-good" : "text-bad"}`}>
                  {Math.round(revenue / m.budget * 100)}% of {money(m.budget)} budget
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Occ({ v, pct }: { v: number; pct: (x: number) => string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-line">
        <div
          className="h-2 rounded-full bg-brand"
          style={{ width: `${Math.min(100, Math.max(0, v * 100))}%` }}
        />
      </div>
      <span className="whitespace-nowrap">{pct(v)}</span>
    </div>
  );
}
/* ================= marketing channels in use (overview banner) ================= */

export function ChannelsBanner({ ids }: { ids?: string[] }) {
  const used = MARKETING_CHANNELS.filter((c) => ids?.includes(c.id));
  if (!used.length) return null;
  const groups = (Object.keys(GROUP_LABEL) as ChannelGroup[]).map((g) => ({ g, items: used.filter((c) => c.group === g) })).filter((x) => x.items.length);
  return (
    <section aria-label="Marketing channels in use" className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5 sm:px-8 lg:px-12">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Marketing channels</p>
        {groups.map(({ g, items }) => (
          <div key={g} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-3">{GROUP_LABEL[g]}</span>
            {items.map((c) => (
              <span key={c.id} title={c.detail} className="inline-flex items-center gap-1.5 rounded-full bg-page px-3 py-1 text-sm font-medium text-ink ring-1 ring-line">
                <span className="text-brand-strong"><ChannelIcon name={c.icon} /></span>{c.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
