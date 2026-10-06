"use client";

import { useMemo, useState } from "react";
import type { Breakdowns, BreakdownRow, Goal, Milestone, SectionNotes } from "@/db/types";
import type { MonthData } from "@/lib/data";
import { formatMetric, formatPercent, metricDef, monthLabel, withDerived } from "@/lib/metrics";
import { outcomeMetric, outcomeNoun } from "@/lib/insights";
import { SectionHead, benchmarkText, type Benchmark } from "./Dashboard";
import { MetricIcon } from "./icons";

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

  type Tile = { key: string; icon: string; label: string; value: string; sub: string; tone?: "brand" | "good" };
  const tiles: Tile[] = [];
  if (optScore != null) tiles.push({ key: "opt", icon: "revenue", label: "Optimisation score", value: `${optScore.toFixed(2)}%`, sub: "Campaign quality score from Google", tone: "brand" });
  if (!m.clicks && m.spend != null) tiles.push({ key: "spend", icon: "spend", label: "Amount spent", value: formatMetric("spend", m.spend, currency, { exact: true }), sub: "Total for the reporting period" });
  if (outcome) tiles.push({
    key: "out", icon: "leads", label: Noun, value: `${n(m[outcome])} ${Noun}`,
    sub: m.clicks ? `${formatPercent(m[outcome] / m.clicks, 2)} of clicks became ${noun}` : outcomeTypes.length ? outcomeTypes.join(", ") : `Total ${noun}`,
  });
  if (cost != null) tiles.push({ key: "cost", icon: "cost", label: `Cost per ${outcomeNoun(outcome!, 1)}`, value: formatMetric("cpl", cost, currency), sub: excluded.length ? `Excludes spend on ${excludedTypes.join(", ").toLowerCase()}` : bench?.text ?? "Average for the month", tone: bench?.good || excluded.length ? "good" : undefined });
  if (m.clicks && m.impressions) tiles.push({ key: "ctr", icon: "impressions", label: "Click-through rate", value: formatPercent(m.clicks / m.impressions, 2), sub: `${n(m.clicks)} clicks on ${n(m.impressions)} impressions` });
  if (!m.clicks && m.impressions) tiles.push({ key: "impr", icon: "impressions", label: "Total impressions", value: n(m.impressions), sub: "Times your ads were shown" });
  if (m.reach) tiles.push({ key: "reach", icon: "leads", label: "Unique reach", value: n(m.reach), sub: "Different people who saw your ads" });
  if (m.clicks && m.spend != null && tiles.length < 5) tiles.push({ key: "spend2", icon: "spend", label: "Total cost", value: formatMetric("spend", m.spend, currency, { exact: true }), sub: "Total for the reporting period" });
  if (!tiles.length) return null;
  return (
    <section aria-label="Key figures" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-4">
      {tiles.map((t) => (
        <div key={t.key} className="min-w-0 rounded-2xl bg-surface p-5 ring-1 ring-line">
          <div className="flex items-start justify-between gap-3">
            <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{t.label}</p>
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong"><MetricIcon metric={t.icon} className="size-[18px]" /></span>
          </div>
          <p className={`num mt-1 whitespace-nowrap text-[clamp(1.4rem,0.9rem+1.2vw,2rem)] leading-none ${t.tone === "brand" ? "text-brand-strong" : t.tone === "good" ? "text-good" : "text-ink"}`}>{t.value}</p>
          <p className={`mt-2 text-sm ${t.key === "out" && m.clicks ? "font-medium text-good" : "text-ink-2"}`}>{t.sub}</p>
        </div>
      ))}
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
    ...(attr("budget") ? [c("budget", "Daily budget", (d) => d.r.attrs?.budget != null ? `${formatMetric("spend", d.r.attrs.budget, currency, { exact: true })} / ${(d.r.attrs.budgetType ?? "day").toLowerCase().replace("daily", "day")}` : "–")] : []),
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
    ...(outcome && clicks ? [c("cr", "Conv. rate", (d) => d.m.clicks && d.m[outcome] ? <span className="text-good">{formatPercent(d.m[outcome] / d.m.clicks, 2)}</span> : "–")] : []),
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
  const idx = months.findIndex((m) => m.month === selected);
  const month = months[idx];
  const prev = idx > 0 ? months[idx - 1] : undefined;
  if (!goals.length) return null;
  return (
    <section className={card}>
      <SectionHead light="Goals" bold={`for ${selected ? monthLabel(selected) : "this month"}`}
        lead={prev ? `Each target compared with ${monthLabel(prev.month)} and ${monthLabel(selected)}.` : "Progress against each monthly target."} />
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
                  {met ? "Target met" : `Target: ${g.direction === "atMost" ? "≤ " : ""}${fmtGoal(g, g.target, currency)}${g.direction === "atLeast" ? "/mo" : ""}`}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-ink-3">{prev ? monthLabel(prev.month) : "Last month"}</p>
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
                  : met ? `${Math.round(p * 100)}% of target achieved.` : `${Math.round(p * 100)}% of target achieved in ${monthLabel(selected).split(" ")[0]}.`}
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
          {slider("budget", "Monthly budget", money(v.budget), 500)}
          {slider("cost", `Cost per ${one}`, money(v.cost), 0.5)}
          {slider("rate", `${one.replace(/^./, (c) => c.toUpperCase())} to ${saleNoun.replace(/s$/, "")} rate`, `${fmtN(v.rate, 1)}%`, 0.1)}
          {slider("value", `Average ${saleNoun.replace(/s$/, "")} value`, money(v.value), Math.max(1, Math.round(start.value / 200)))}
          <button type="button" className="justify-self-start text-sm font-medium text-brand-strong hover:underline print:hidden" onClick={() => setV(start)}>Reset to this month’s figures</button>
        </div>
        <div className="rounded-3xl bg-night p-6 text-white sm:p-8 lg:col-span-3">
          <h4 className="font-semibold uppercase tracking-wide text-white/70">Projected <span className="text-brand">outcomes</span></h4>
          <div className="mt-6 grid gap-8 sm:grid-cols-2 [&>*]:min-w-0">
            <Out label={`${noun.replace(/^./, (c) => c.toUpperCase())} per month`} value={fmtN(leads)} sub={`Budget ÷ cost per ${one}`} />
            <Out label={`${saleNoun.replace(/^./, (c) => c.toUpperCase())} per month`} value={fmtN(sales, 1)} sub={`${noun.replace(/^./, (c) => c.toUpperCase())} × ${fmtN(v.rate, 1)}%`} />
            <Out label="Sales value" value={revenue >= 1_000_000 ? formatMetric("revenue", revenue, currency, { compact: true }) : money(revenue)} sub={`${saleNoun.replace(/^./, (c) => c.toUpperCase())} × average value`} accent="good" />
            <Out label="Return on ad spend" value={`${fmtN(roas, 1)}×`} sub="Sales value ÷ budget" accent="brand" />
          </div>
          <p className="mt-8 rounded-2xl bg-white/[0.06] p-4 text-sm leading-relaxed text-white/80 ring-1 ring-white/10">
            At {money(v.budget)} a month and {money(v.cost)} per {one}, you’d expect about {fmtN(leads)} {noun}. If {fmtN(v.rate, 1)}% become {saleNoun},
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
