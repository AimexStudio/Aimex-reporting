"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardData, MonthData } from "@/lib/data";
import type { Breakdowns } from "@/db/types";
import { DERIVED_METRICS, formatMetric, formatPercent, metricDef, monthLabel, pctChange } from "@/lib/metrics";
import {
  audienceGrid, audienceName, bestValue, genderLabel, insightSentences, outcomeMetric, outcomeNoun, rank,
} from "@/lib/insights";
import { MetricIcon } from "./icons";
import { AgeChart, CostTrend, Donut, PALETTE, SharePairs, SpendVsOutcome } from "./charts";

/** Figures shown as tiles, in priority order. Cost per 1,000 impressions lives only in the full table. */
const TILE_PRIORITY = ["revenue", "spend", "roas", "conversions", "cpa", "leads", "cpl", "clicks", "ctr", "conv_rate", "sessions", "impressions", "reach", "followers", "video_views"];
const CHANNEL_COLUMNS = ["spend", "revenue", "roas", "conversions", "cpa", "leads", "cpl", "clicks", "ctr", "impressions", "sessions"];
const SERIES = PALETTE;
const COST_KEY: Record<string, string> = { leads: "cpl", conversions: "cpa" };

export function Dashboard({ data }: { data: DashboardData }) {
  const { months, client } = data;
  const cur = client.currency;
  const [selected, setSelected] = useState(months.at(-1)?.month ?? "");
  const idx = months.findIndex((m) => m.month === selected);
  const month = months[idx];
  const prev = idx > 0 ? months[idx - 1] : undefined;

  if (!month) {
    return (
      <section className="bg-night text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <h2 className="brand-h text-white/70">Your <strong className="text-white">report</strong></h2>
          <p className="mt-4 max-w-xl text-headline font-medium">Your first report is on its way.</p>
          <p className="mt-3 max-w-prose text-white/70">
            Aimex Studio hasn’t uploaded any results yet. Once your first month is in, you’ll see what your marketing delivered here.
          </p>
        </div>
      </section>
    );
  }

  const outcome = outcomeMetric(month.totals);
  const equationKeys = equationMetrics(month, outcome);
  const breakdowns = month.channels.filter((c) => c.breakdowns).map((c) => ({ channel: c.channel, b: c.breakdowns! }));

  return (
    <>
      <Hero months={months} month={month} prev={prev} outcome={outcome} currency={cur} onMonth={setSelected} />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-5 py-12 sm:px-8">
        <Tiles months={months} idx={idx} exclude={equationKeys} currency={cur} />
        {outcome && month.channels.some((c) => (c.metrics[outcome] ?? 0) > 0 && c.metrics.impressions) ? <Funnel month={month} outcome={outcome} currency={cur} /> : null}
        {breakdowns.length > 0 && outcome && (
          <WhatWorked items={breakdowns} metric={outcome} currency={cur} showChannel={breakdowns.length > 1} />
        )}
        {months.length >= 2 && outcome && month.totals.spend != null && <MoneyOverTime months={months} outcome={outcome} currency={cur} />}
        {months.length >= 2 && <Trend months={months} selected={selected} onSelect={setSelected} currency={cur} defaultMetric={outcome ?? "spend"} />}
        {month.channels.length >= 2 && <Channels month={month} prev={prev} currency={cur} />}
        <AllNumbers month={month} prev={prev} currency={cur} />
      </main>
    </>
  );
}

/* ================= hero: was it worth it? ================= */

function equationMetrics(m: MonthData, outcome: string | null): string[] {
  const t = m.totals;
  if (t.spend && t.revenue) return ["spend", "revenue", "roas"];
  if (t.spend && outcome) return ["spend", outcome, COST_KEY[outcome] ?? ""].filter(Boolean);
  return [];
}

function Hero({ months, month, prev, outcome, currency, onMonth }: {
  months: MonthData[]; month: MonthData; prev?: MonthData; outcome: string | null; currency: string; onMonth: (m: string) => void;
}) {
  const t = month.totals;
  const [name, year] = monthLabel(month.month).split(" ");
  return (
    <section className="relative overflow-hidden bg-night text-white" aria-labelledby="hero-heading">
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-brand/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-5 pb-12 pt-10 sm:px-8 sm:pb-14">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="hero-heading" className="brand-h text-white/75">
            {name} {year} <strong className="text-brand">results</strong>
          </h2>
          <MonthPicker months={months} value={month.month} onChange={onMonth} />
        </div>

        <p key={month.month} className="rise mt-5 max-w-[32ch] text-headline font-medium tracking-tight text-balance">
          {headline(month, prev, currency)}
        </p>
        {months.length === 1 && (
          <p className="mt-3 text-white/60">Your first report. From next month you’ll also see how each number has changed.</p>
        )}

        {t.spend && t.revenue ? (
          <RevenueEquation month={month} prev={prev} currency={currency} />
        ) : t.spend && outcome ? (
          <OutcomeEquation month={month} prev={prev} outcome={outcome} currency={currency} />
        ) : null}

        {month.note && (
          <figure className="mt-10 max-w-2xl rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10">
            <blockquote className="leading-relaxed text-white/90">{month.note}</blockquote>
            <figcaption className="mt-2 text-sm text-brand">Your Aimex Studio team</figcaption>
          </figure>
        )}
      </div>
    </section>
  );
}

function Step({ label, value, sub, change, last }: { label: string; value: string; sub?: string; change?: React.ReactNode; last?: boolean }) {
  return (
    <div className="relative flex flex-col">
      <p className="text-sm text-white/60">{label}</p>
      <p className="num mt-1 text-[clamp(2rem,1.2rem+3vw,3.25rem)] leading-none text-white">{value}</p>
      {sub && <p className="mt-2 text-sm text-white/60">{sub}</p>}
      {change && <div className="mt-2">{change}</div>}
      {!last && (
        <span aria-hidden="true" className="absolute -right-5 top-8 hidden text-2xl text-brand md:block">→</span>
      )}
    </div>
  );
}

function OutcomeEquation({ month, prev, outcome, currency }: { month: MonthData; prev?: MonthData; outcome: string; currency: string }) {
  const t = month.totals;
  const costKey = COST_KEY[outcome];
  const cost = costKey ? t[costKey] : t.spend / t[outcome];
  const noun = outcomeNoun(outcome);
  return (
    <div className="mt-10 grid gap-8 rounded-3xl bg-night-2 p-6 ring-1 ring-white/10 sm:p-8 md:grid-cols-3 md:gap-10">
      <Step label="You invested" value={formatMetric("spend", t.spend, currency)} sub="in advertising"
        change={<Change change={pctChange(t.spend, prev?.totals.spend)} higherIsBetter={null} tone="dark" />} />
      <Step label="You received" value={formatMetric(outcome, t[outcome], currency)} sub={noun}
        change={<Change change={pctChange(t[outcome], prev?.totals[outcome])} higherIsBetter tone="dark" />} />
      <Step last label={`Each ${outcomeNoun(outcome, 1)} cost`} value={formatMetric("cpl", cost, currency)} sub="on average"
        change={<Change change={pctChange(cost, prev && prev.totals[outcome] ? (costKey ? prev.totals[costKey] : prev.totals.spend / prev.totals[outcome]) : undefined)} higherIsBetter={false} tone="dark" />} />
    </div>
  );
}

function RevenueEquation({ month, prev, currency }: { month: MonthData; prev?: MonthData; currency: string }) {
  const t = month.totals;
  const one = formatMetric("revenue", 1, currency).replace(/\.00$/, "");
  const ratio = Math.min(1, t.spend / t.revenue);
  return (
    <div className="mt-10 rounded-3xl bg-night-2 p-6 ring-1 ring-white/10 sm:p-8">
      <div className="grid gap-8 md:grid-cols-3 md:gap-10">
        <Step label="You invested" value={formatMetric("spend", t.spend, currency)} sub="in advertising"
          change={<Change change={pctChange(t.spend, prev?.totals.spend)} higherIsBetter={null} tone="dark" />} />
        <Step label="It brought in" value={formatMetric("revenue", t.revenue, currency)} sub="in tracked revenue"
          change={<Change change={pctChange(t.revenue, prev?.totals.revenue)} higherIsBetter tone="dark" />} />
        <Step last label="Your return" value={formatMetric("roas", t.roas, currency)}
          sub={`${formatMetric("revenue", t.roas, currency)} back for every ${one} spent`}
          change={<Change change={pctChange(t.roas, prev?.totals.roas)} higherIsBetter tone="dark" />} />
      </div>
      <div className="mt-8 grid gap-2.5" role="img" aria-label={`Spend ${formatMetric("spend", t.spend, currency)} compared with revenue ${formatMetric("revenue", t.revenue, currency)}`}>
        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-sm text-white/60">Spend</span>
          <div className="h-3 flex-1 rounded-full bg-white/10"><div className="grow h-3 rounded-full bg-white/50" style={{ width: `${ratio * 100}%` }} /></div>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-sm text-white/60">Revenue</span>
          <div className="h-3 flex-1 rounded-full bg-white/10"><div className="grow h-3 rounded-full bg-brand" style={{ width: "100%" }} /></div>
        </div>
      </div>
    </div>
  );
}

function MonthPicker({ months, value, onChange }: { months: MonthData[]; value: string; onChange: (m: string) => void }) {
  const i = months.findIndex((m) => m.month === value);
  const btn = "grid size-9 place-items-center rounded-lg text-white/80 ring-1 ring-white/20 hover:bg-white/10 disabled:opacity-30";
  if (months.length < 2) return null;
  return (
    <div className="flex items-center gap-1.5">
      <button className={btn} aria-label="Previous month" disabled={i <= 0} onClick={() => onChange(months[i - 1].month)}>‹</button>
      <select className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white ring-1 ring-white/20 [&>option]:text-ink"
        value={value} onChange={(e) => onChange(e.target.value)} aria-label="Month">
        {[...months].reverse().map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
      </select>
      <button className={btn} aria-label="Next month" disabled={i >= months.length - 1} onClick={() => onChange(months[i + 1].month)}>›</button>
    </div>
  );
}

/* ================= shared bits ================= */

function SectionHead({ light, bold, lead }: { light: string; bold: string; lead?: string }) {
  return (
    <div className="mb-5">
      <h3 className="brand-h text-ink">{light} <strong>{bold}</strong></h3>
      {lead && <p className="mt-1.5 max-w-prose text-ink-2">{lead}</p>}
    </div>
  );
}

function Change({ change, higherIsBetter, tone = "light", suffix }: { change: number | null; higherIsBetter: boolean | null; tone?: "light" | "dark"; suffix?: string }) {
  if (change == null || !Number.isFinite(change)) return null;
  if (Math.abs(change) < 0.005) return <span className={`text-sm ${tone === "dark" ? "text-white/50" : "text-ink-3"}`}>No change</span>;
  const good = higherIsBetter == null ? null : change > 0 === higherIsBetter;
  const cls = good == null
    ? tone === "dark" ? "bg-white/10 text-white/80" : "bg-line-soft text-ink-2"
    : good
      ? tone === "dark" ? "bg-good/25 text-[#7ee2bd]" : "bg-good-soft text-good"
      : tone === "dark" ? "bg-bad/25 text-[#f4a3b2]" : "bg-bad-soft text-bad";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      <span aria-hidden="true">{change > 0 ? "▲" : "▼"}</span>
      <span className="sr-only">{change > 0 ? "Up" : "Down"}</span>
      {formatPercent(Math.abs(change), Math.abs(change) < 0.1 ? 1 : 0)}
      <span className="font-normal opacity-80">{suffix ?? "vs last month"}</span>
    </span>
  );
}

function Sparkline({ values }: { values: (number | undefined)[] }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const w = 72, h = 24, n = values.length - 1 || 1;
  const d = pts.map(([i, v], j) => `${j ? "L" : "M"}${((i / n) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join("");
  return (
    <svg width={w} height={h} aria-hidden="true" className="shrink-0 text-brand">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ================= tiles ================= */

function Tiles({ months, idx, exclude, currency }: { months: MonthData[]; idx: number; exclude: string[]; currency: string }) {
  const month = months[idx];
  const prev = idx > 0 ? months[idx - 1] : undefined;
  const keys = TILE_PRIORITY.filter((k) => month.totals[k] != null && !exclude.includes(k)).slice(0, 6);
  if (keys.length < 2) return null;
  return (
    <section aria-labelledby="tiles-heading">
      <h3 id="tiles-heading" className="sr-only">Key figures</h3>
      <SectionHead light="The" bold="numbers" />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {keys.map((k) => {
          const def = metricDef(k);
          const series = months.slice(Math.max(0, idx - 11), idx + 1).map((m) => m.totals[k]);
          // Name the source when only some channels report this figure (e.g. Meta exports have no clicks).
          const inputs = DERIVED_METRICS.find((d) => d.key === k)?.inputs ?? [k, k];
          const from = month.channels.filter((c) => c.metrics[inputs[0]] != null && c.metrics[inputs[1]] != null).map((c) => c.channel);
          const partial = month.channels.length > 1 && from.length > 0 && from.length < month.channels.length;
          return (
            <div key={k} className="rounded-2xl bg-surface p-5 ring-1 ring-line">
              <dt className="flex items-center gap-2 text-sm text-ink-2">
                <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-strong"><MetricIcon metric={k} className="size-[18px]" /></span>
                {def.label}
              </dt>
              <dd className="num mt-3 text-[1.75rem] leading-none text-ink">{formatMetric(k, month.totals[k], currency, { compact: true })}</dd>
              {partial && <dd className="mt-1 text-xs text-ink-3">{from.join(" and ")} only</dd>}
              <dd className="mt-3 flex min-h-6 items-center justify-between gap-2">
                <Change change={pctChange(month.totals[k], prev?.totals[k])} higherIsBetter={def.higherIsBetter} suffix="" />
                <Sparkline values={series} />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/* ================= funnel ================= */

function Funnel({ month, outcome, currency }: { month: MonthData; outcome: string; currency: string }) {
  // Only channels that produced this outcome, so Google views aren't compared with Meta leads.
  const scoped = month.channels.filter((c) => (c.metrics[outcome] ?? 0) > 0);
  const sum = (k: string) => scoped.reduce((s, c) => s + (c.metrics[k] ?? 0), 0);
  // A middle step only counts if every channel in the funnel reports it; otherwise
  // Google clicks would be compared with Meta leads that never passed through them.
  const all = (k: string) => scoped.length > 0 && scoped.every((c) => (c.metrics[k] ?? 0) > 0);
  const t: Record<string, number> = {
    impressions: all("impressions") ? sum("impressions") : 0,
    clicks: all("clicks") ? sum("clicks") : 0,
    landing_page_views: all("landing_page_views") ? sum("landing_page_views") : 0,
    [outcome]: sum(outcome),
  };
  const fromChannels = scoped.length < month.channels.length ? scoped.map((c) => c.channel).join(" and ") : null;
  const steps = [
    { key: "impressions", label: "Times your ads were seen", value: t.impressions },
    t.clicks ? { key: "clicks", label: "Clicks to find out more", value: t.clicks } : null,
    t.landing_page_views && outcome !== "landing_page_views" ? { key: "landing_page_views", label: "Website visits", value: t.landing_page_views } : null,
    { key: outcome, label: outcomeNoun(outcome).replace(/^./, (c) => c.toUpperCase()), value: t[outcome] },
  ].filter((s): s is { key: string; label: string; value: number } => !!s && s.value > 0);
  if (steps.length < 2) return null;
  const ratio = Math.round(steps[0].value / steps[steps.length - 1].value);
  const widths = steps.map((_, i) => 100 - (i * 62) / (steps.length - 1)); // readable taper; true ratios are in the labels
  return (
    <section aria-labelledby="funnel-heading" className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
      <div id="funnel-heading">
        <SectionHead light="From views to" bold={outcomeNoun(outcome)}
          lead={`${fromChannels ? `On ${fromChannels}, 1` : "1"} in every ${new Intl.NumberFormat("en-US").format(ratio).replace(/,/g, "\u00a0")} times your ads were seen became ${outcome === "leads" ? "a lead" : `a ${outcomeNoun(outcome, 1)}`}.`} />
      </div>
      <ol className="grid gap-2">
        {steps.map((s, i) => {
          const rate = i > 0 ? s.value / steps[i - 1].value : null;
          return (
            <li key={s.key}>
              {rate != null && (
                <p className="py-1 pl-4 text-xs text-ink-3">
                  <span aria-hidden="true">↓ </span>{formatPercent(rate, rate < 0.01 ? 2 : 1)}{" "}
                  {s.key === "clicks" ? "clicked" : s.key === "landing_page_views" ? "visited your website" : `became ${outcome === "leads" ? "leads" : outcomeNoun(outcome)}`}
                </p>
              )}
              <div className="grow flex items-center justify-between gap-4 rounded-xl px-4 py-3.5"
                style={{ width: `${widths[i]}%`, minWidth: "min(100%, 260px)", background: i === steps.length - 1 ? "var(--color-night)" : `color-mix(in srgb, var(--color-brand) ${22 + i * 14}%, white)`, color: i === steps.length - 1 ? "white" : "var(--color-ink)" }}>
                <span className="text-sm font-medium">{s.label}</span>
                <span className="num text-lg">{formatMetric(s.key, s.value, currency)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ================= what worked best ================= */

function WhatWorked({ items, metric, currency, showChannel }: { items: { channel: string; b: Breakdowns }[]; metric: string; currency: string; showChannel: boolean }) {
  return (
    <section aria-labelledby="worked-heading" className="grid min-w-0 grid-cols-1 gap-6">
      <div id="worked-heading">
        <SectionHead light="What" bold="worked best" lead={`Where your ${outcomeNoun(metric)} came from, so you can see what your budget is buying.`} />
      </div>
      {items.map(({ channel, b }) => (
        <div key={channel} className="grid min-w-0 grid-cols-1 gap-6">
          {showChannel && <h4 className="text-lg font-semibold">{channel}</h4>}
          <Insights lines={insightSentences(b, metric, currency)} />
          <MoneyWent b={b} metric={metric} />
          <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-5">
            {(b.ads ?? b.campaigns) && (
              <div className="lg:col-span-3"><TopAds rows={(b.ads ?? b.campaigns)!} metric={metric} currency={currency} unit={b.ads ? "ad" : "campaign"} /></div>
            )}
            {b.adSets && b.adSets.length >= 2 && (
              <div className={`self-start ${b.ads ?? b.campaigns ? "lg:col-span-2" : "lg:col-span-5"}`}><Targeting rows={b.adSets} metric={metric} currency={currency} /></div>
            )}
          </div>
          {b.audiences && <Audiences rows={b.audiences} metric={metric} currency={currency} />}
        </div>
      ))}
    </section>
  );
}

function Insights({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="grid gap-3 md:grid-cols-3">
      {lines.map((l) => (
        <li key={l} className="flex gap-3 rounded-2xl bg-brand-soft p-4 text-[15px] leading-snug text-ink">
          <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">✓</span>
          {l}
        </li>
      ))}
    </ul>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "brand" | "good" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone === "brand" ? "bg-night text-brand" : "bg-good-soft text-good"}`}>{children}</span>
  );
}

function TopAds({ rows, metric, currency, unit = "ad" }: { rows: NonNullable<Breakdowns["ads"]>; metric: string; currency: string; unit?: "ad" | "campaign" }) {
  const ranked = rank(rows, metric);
  const best = bestValue(ranked);
  const max = Math.max(1, ...ranked.map((r) => r.outcome));
  const [all, setAll] = useState(false);
  const shown = all ? ranked : ranked.slice(0, 5);
  const noun = outcomeNoun(metric);
  return (
    <div className="h-full rounded-3xl bg-surface p-6 ring-1 ring-line">
      <h4 className="text-lg font-semibold">Your best-performing {unit}s</h4>
      <p className="mt-0.5 text-sm text-ink-3">Ranked by {noun}, with what each one cost</p>
      <ol className="mt-5 grid gap-4">
        {shown.map((r, i) => (
          <li key={r.key}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="num w-5 text-ink-3">{i + 1}</span>
              <span className="font-medium">{r.label}</span>
              {i === 0 && r.outcome > 0 && <Badge tone="brand">Most {noun}</Badge>}
              {best?.key === r.key && <Badge tone="good">Best value</Badge>}
            </div>
            <div className="mt-1.5 flex items-center gap-3 pl-7">
              <div className="h-2.5 flex-1 rounded-full bg-line-soft">
                <div className="grow h-2.5 rounded-full" style={{ width: `${(r.outcome / max) * 100}%`, background: i === 0 ? "var(--color-brand)" : "color-mix(in srgb, var(--color-brand) 55%, white)" }} />
              </div>
              <span className="num w-12 text-right">{r.outcome}</span>
            </div>
            <p className="mt-1 pl-7 text-sm text-ink-3">
              {r.costPer != null ? `${formatMetric("cpl", r.costPer, currency)} per ${outcomeNoun(metric, 1)}` : `No ${noun} yet`}
              {" "}from {formatMetric("spend", r.spend, currency)} spent
            </p>
          </li>
        ))}
      </ol>
      {ranked.length > 5 && (
        <button className="mt-4 text-sm font-medium text-brand-strong hover:underline" onClick={() => setAll(!all)}>
          {all ? `Show fewer ${unit}s` : `Show all ${ranked.length} ${unit}s`}
        </button>
      )}
    </div>
  );
}

function Targeting({ rows, metric, currency }: { rows: NonNullable<Breakdowns["adSets"]>; metric: string; currency: string }) {
  const ranked = rank(rows, metric);
  const best = bestValue(ranked, 0.05);
  const noun = outcomeNoun(metric);
  return (
    <div className="rounded-3xl bg-night p-6 text-white">
      <h4 className="text-lg font-semibold">Who we targeted</h4>
      <p className="mt-0.5 text-sm text-white/60">How each audience approach performed</p>
      <ul className="mt-5 grid gap-3">
        {ranked.slice(0, 4).map((r) => (
          <li key={r.key} className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.label}</span>
              {best?.key === r.key && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-night">Lowest cost</span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="num text-2xl leading-none">{r.outcome}</p>
                <p className="mt-1 text-xs text-white/60">{noun} ({Math.round(r.share * 100)}%)</p>
              </div>
              <div>
                <p className="num text-2xl leading-none">{r.costPer != null ? formatMetric("cpl", r.costPer, currency) : "–"}</p>
                <p className="mt-1 text-xs text-white/60">per {outcomeNoun(metric, 1)}</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-white/10"><div className="grow h-1.5 rounded-full bg-brand" style={{ width: `${r.share * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AudienceCharts({ g, genders, metric, currency }: { g: ReturnType<typeof audienceGrid>; genders: string[]; metric: string; currency: string }) {
  const noun = outcomeNoun(metric);
  const realGenders = genders.filter((x) => x !== "all");
  const genderData = realGenders.map((x) => ({ name: genderLabel(x), value: g.cells.filter((c) => c.gender === x).reduce((s, c) => s + c.outcome, 0) }));
  const showAges = g.ages.length >= 2 && !(g.ages.length === 1 && g.ages[0] === "All ages");
  if (!showAges && realGenders.length < 2) return null;
  return (
    <div className="mt-6 grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-5">
      {showAges && (
        <div className="min-w-0 lg:col-span-3">
          <h5 className="mb-2 font-semibold">{noun[0].toUpperCase() + noun.slice(1)} by age</h5>
          <AgeChart rows={g.byAge.map((a) => ({ age: a.age, outcome: a.outcome, costPer: a.costPer }))} noun={noun} currency={currency} />
        </div>
      )}
      {realGenders.length >= 2 && (
        <div className="min-w-0 lg:col-span-2">
          <h5 className="mb-4 font-semibold">{noun[0].toUpperCase() + noun.slice(1)} by gender</h5>
          <Donut data={genderData} format={(v) => `${v} ${outcomeNoun(metric, v)}`}
            centerValue={String(genderData.reduce((s, d) => s + d.value, 0))} centerLabel={noun} />
        </div>
      )}
    </div>
  );
}

function Audiences({ rows, metric, currency }: { rows: NonNullable<Breakdowns["audiences"]>; metric: string; currency: string }) {
  const g = audienceGrid(rows, metric);
  const noun = outcomeNoun(metric);
  const single = g.genders.length === 1 && (g.genders[0] === "all");
  const unknownTotal = g.cells.filter((c) => c.gender === "unknown").reduce((s, c) => s + c.outcome, 0);
  const hideUnknown = g.genders.includes("unknown") && g.genders.length > 1 && unknownTotal / (g.total || 1) < 0.02;
  const genders = hideUnknown ? g.genders.filter((x) => x !== "unknown") : g.genders;
  return (
    <div className="min-w-0 rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h4 className="text-lg font-semibold">Who responded</h4>
          <p className="mt-0.5 text-sm text-ink-3">{noun.replace(/^./, (c) => c.toUpperCase())} by age{single ? "" : " and gender"}. Darker means more {noun}.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {g.top && g.top.outcome > 0 && (
            <div className="rounded-xl bg-night px-4 py-2.5 text-white">
              <p className="text-xs text-white/60">Most {noun}</p>
              <p className="font-semibold">{audienceName(g.top.age, g.top.gender)}</p>
            </div>
          )}
          {g.value && g.value.costPer != null && (
            <div className="rounded-xl bg-good-soft px-4 py-2.5 text-good">
              <p className="text-xs opacity-80">Lowest cost per {outcomeNoun(metric, 1)}</p>
              <p className="font-semibold">{audienceName(g.value.age, g.value.gender)}, {formatMetric("cpl", g.value.costPer, currency)}</p>
            </div>
          )}
        </div>
      </div>
      <AudienceCharts g={g} genders={genders} metric={metric} currency={currency} />
      <h5 className="mt-8 font-semibold">Age and gender together</h5>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] border-separate border-spacing-1.5 text-sm">
          <thead>
            <tr>
              <th className="w-24 text-left font-medium text-ink-2">Age</th>
              {genders.map((x) => <th key={x} className="text-center font-medium text-ink-2">{genderLabel(x)}</th>)}
              <th className="w-28 text-right font-medium text-ink-2">All</th>
            </tr>
          </thead>
          <tbody>
            {g.ages.map((age) => {
              const totalAge = g.byAge.find((a) => a.age === age)!;
              return (
                <tr key={age}>
                  <th scope="row" className="text-left font-medium">{age}</th>
                  {genders.map((gender) => {
                    const m = g.cell.get(`${age}|${gender}`);
                    const v = m?.[metric] ?? 0;
                    const strength = v / g.max;
                    const cpl = v && m?.spend ? m.spend / v : null;
                    const dark = strength > 0.55;
                    return (
                      <td key={gender} className="rounded-lg px-2 py-2.5 text-center"
                        style={{ background: v ? `color-mix(in srgb, var(--color-brand) ${Math.round(12 + strength * 88)}%, white)` : "var(--color-line-soft)", color: dark ? "var(--color-night)" : "var(--color-ink)" }}
                        title={cpl ? `${v} ${noun}, ${formatMetric("cpl", cpl, currency)} each` : `${v} ${noun}`}>
                        <span className="num block text-base leading-none">{v}</span>
                        <span className="mt-1 block text-[11px] opacity-75">{cpl ? formatMetric("cpl", cpl, currency) : "–"}</span>
                      </td>
                    );
                  })}
                  <td className="text-right">
                    <span className="num">{totalAge.outcome}</span>
                    <span className="block text-[11px] text-ink-3">{Math.round(totalAge.share * 100)}% of {noun}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-3">
        Each square shows {noun} and the cost per {outcomeNoun(metric, 1)}.
        {hideUnknown && unknownTotal > 0 && ` ${unknownTotal} ${outcomeNoun(metric, unknownTotal)} from people who didn’t share their gender are included in the All column.`}
      </p>
    </div>
  );
}

function MoneyWent({ b, metric }: { b: Breakdowns; metric: string }) {
  const noun = outcomeNoun(metric);
  const toPairs = (rows: NonNullable<Breakdowns["ads"]>) => {
    const r = rank(rows, metric);
    const spend = r.reduce((s, x) => s + x.spend, 0) || 1;
    return [...r]
      .sort((a, c) => c.spend - a.spend)
      .map((x) => ({ label: x.label, spend: x.spend / spend, outcome: x.share }))
      .filter((x) => x.spend >= 0.01 || x.outcome >= 0.01) // drop ads that barely ran and produced nothing
      .slice(0, 6);
  };
  const unitRows = b.ads ?? b.campaigns;
  const unit = b.ads ? "ad" : "campaign";
  const ads = unitRows && unitRows.length >= 2 ? toPairs(unitRows) : null;
  const sets = b.adSets && b.adSets.length >= 2 ? toPairs(b.adSets) : null;
  if (!ads && !sets) return null;
  return (
    <div className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
      <SectionHead light="Where the money" bold="went"
        lead={`Grey shows each ${ads ? `${unit}’s` : "approach’s"} share of the budget, orange its share of ${noun}. Orange longer than grey means it delivered more than its share.`} />
      <div className={`grid min-w-0 grid-cols-1 gap-8 ${ads && sets ? "lg:grid-cols-2" : ""}`}>
        {ads && <div className="min-w-0"><h4 className="mb-2 font-semibold">By {unit}</h4><SharePairs rows={ads} noun={noun} /></div>}
        {sets && <div className="min-w-0"><h4 className="mb-2 font-semibold">By targeting approach</h4><SharePairs rows={sets} noun={noun} /></div>}
      </div>
    </div>
  );
}

function MoneyOverTime({ months, outcome, currency }: { months: MonthData[]; outcome: string; currency: string }) {
  const noun = outcomeNoun(outcome);
  const costKey = COST_KEY[outcome];
  const recent = months.slice(-12);
  const rows = recent.map((m) => ({ month: m.month, spend: m.totals.spend, outcome: m.totals[outcome] }));
  const costRows = recent.map((m) => ({
    month: m.month,
    value: costKey ? m.totals[costKey] : m.totals.spend && m.totals[outcome] ? m.totals.spend / m.totals[outcome] : undefined,
  }));
  const label = noun[0].toUpperCase() + noun.slice(1);
  return (
    <section aria-labelledby="money-heading" className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-5">
      <div className="min-w-0 rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8 lg:col-span-3">
        <div id="money-heading"><SectionHead light="Money in," bold={`${noun} out`} lead={`What you invested each month (grey) and the ${noun} it brought in (orange).`} /></div>
        <SpendVsOutcome rows={rows} outcomeLabel={label} currency={currency} outcomeKey={outcome} />
      </div>
      <div className="min-w-0 rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8 lg:col-span-2">
        <SectionHead light={`Cost per`} bold={outcomeNoun(outcome, 1)} lead="Lower is better: you’re getting more for the same money." />
        <CostTrend rows={costRows} metric={costKey ?? "cpl"} currency={currency} label={`Cost per ${outcomeNoun(outcome, 1)}`} />
      </div>
    </section>
  );
}

/* ================= trend & channels ================= */

function Trend({ months, selected, onSelect, currency, defaultMetric }: {
  months: MonthData[]; selected: string; onSelect: (m: string) => void; currency: string; defaultMetric: string;
}) {
  const keys = useMemo(() => {
    const set = new Set(months.flatMap((m) => Object.keys(m.totals)));
    const ordered = TILE_PRIORITY.filter((k) => set.has(k));
    return [...ordered, ...[...set].filter((k) => !ordered.includes(k)).sort()];
  }, [months]);
  const [metric, setMetric] = useState(keys.includes(defaultMetric) ? defaultMetric : keys[0]);
  const rows = months.slice(-24).map((m) => ({ month: m.month, label: monthLabel(m.month, "short"), value: m.totals[metric] ?? null }));
  return (
    <section aria-labelledby="trend-heading" className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div id="trend-heading"><SectionHead light="Month by" bold="month" lead="Select a bar to see that month." /></div>
        <select className="input w-auto py-1.5 text-sm" value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Measure shown in chart">
          {keys.map((k) => <option key={k} value={k}>{metricDef(k).label}</option>)}
        </select>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--color-ink-3)", fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} width={64} tick={{ fill: "var(--color-ink-3)", fontSize: 12 }}
              tickFormatter={(v: number) => formatMetric(metric, v, currency, { axis: true })} />
            <Tooltip cursor={{ fill: "var(--color-line-soft)" }}
              contentStyle={{ borderRadius: 10, border: "1px solid var(--color-line)", fontFamily: "inherit" }}
              labelFormatter={(_, p) => (p?.[0]?.payload?.month ? monthLabel(p[0].payload.month) : "")}
              formatter={(v) => [formatMetric(metric, Number(v), currency), metricDef(metric).label]} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={44} className="cursor-pointer"
              onClick={(d) => { const m = (d as { payload?: { month?: string } }).payload?.month; if (m) onSelect(m); }}>
              {rows.map((r) => <Cell key={r.month} fill={r.month === selected ? "var(--color-brand)" : "#d7dbe2"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Channels({ month, prev, currency }: { month: MonthData; prev?: MonthData; currency: string }) {
  const cols = CHANNEL_COLUMNS.filter((k) => month.channels.some((c) => c.metrics[k] != null));
  const prevBy = new Map(prev?.channels.map((c) => [c.channel, c.metrics]) ?? []);
  return (
    <section aria-labelledby="channel-heading" className="rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
      <div id="channel-heading">
        <SectionHead light="Results by" bold="channel" lead="How your budget and results were split across channels." />
      </div>
      <ChannelDonuts month={month} currency={currency} />
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-2">
              <th className="py-2 pr-4 font-medium">Channel</th>
              {cols.map((k) => <th key={k} className="px-3 py-2 text-right font-medium">{metricDef(k).label}</th>)}
            </tr>
          </thead>
          <tbody>
            {month.channels.map((c, i) => (
              <tr key={c.channel} className="border-b border-line-soft last:border-0">
                <th scope="row" className="whitespace-nowrap py-3 pr-4 text-left font-medium">
                  <span className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: SERIES[i % SERIES.length] }} />
                  {c.channel}
                </th>
                {cols.map((k) => {
                  const ch = pctChange(c.metrics[k], prevBy.get(c.channel)?.[k]);
                  const hib = metricDef(k).higherIsBetter;
                  const tone = hib == null ? "text-ink-3" : ch != null && ch > 0 === hib ? "text-good" : "text-bad";
                  return (
                    <td key={k} className="px-3 py-3 text-right">
                      {formatMetric(k, c.metrics[k], currency)}
                      {ch != null && Math.abs(ch) >= 0.005 && (
                        <span className={`block text-xs ${tone}`}>{ch > 0 ? "+" : "−"}{Math.round(Math.abs(ch) * 100)}%</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChannelDonuts({ month, currency }: { month: MonthData; currency: string }) {
  const outcome = outcomeMetric(month.totals);
  const spendData = month.channels.map((c) => ({ name: c.channel, value: c.metrics.spend ?? 0 }));
  const outData = outcome ? month.channels.map((c) => ({ name: c.channel, value: c.metrics[outcome] ?? 0 })) : [];
  const resultKey = month.totals.revenue ? "revenue" : outcome;
  const resData = resultKey ? month.channels.map((c) => ({ name: c.channel, value: c.metrics[resultKey] ?? 0 })) : outData;
  const hasSpend = spendData.filter((d) => d.value > 0).length >= 2;
  const hasRes = resData.filter((d) => d.value > 0).length >= 1 && resultKey;
  if (!hasSpend && !hasRes) return null;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-2">
      {hasSpend && (
        <div className="min-w-0">
          <h4 className="mb-4 font-semibold">Share of spend</h4>
          <Donut data={spendData} format={(v) => formatMetric("spend", v, currency, { compact: true })}
            centerValue={formatMetric("spend", month.totals.spend, currency, { compact: true })} centerLabel="invested" />
        </div>
      )}
      {hasRes && resultKey && (
        <div className="min-w-0">
          <h4 className="mb-4 font-semibold">Share of {resultKey === "revenue" ? "revenue" : outcomeNoun(resultKey)}</h4>
          <Donut data={resData} format={(v) => formatMetric(resultKey, v, currency, { compact: true })}
            centerValue={formatMetric(resultKey, month.totals[resultKey], currency, { compact: true })}
            centerLabel={resultKey === "revenue" ? "revenue" : outcomeNoun(resultKey)} />
        </div>
      )}
    </div>
  );
}

function AllNumbers({ month, prev, currency }: { month: MonthData; prev?: MonthData; currency: string }) {
  const keys = Object.keys(month.totals);
  return (
    <details className="group rounded-3xl bg-surface p-6 ring-1 ring-line sm:p-8">
      <summary className="cursor-pointer list-none">
        <span className="brand-h">Every <strong>number</strong></span>
        <span className="ml-3 text-sm text-ink-3 group-open:hidden">Show the full table for {monthLabel(month.month)}</span>
      </summary>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-ink-2">
              <th className="py-2 font-medium">Measure</th>
              <th className="py-2 text-right font-medium">{monthLabel(month.month, "short")}</th>
              {prev && <th className="py-2 text-right font-medium">{monthLabel(prev.month, "short")}</th>}
              {prev && <th className="py-2 text-right font-medium">Change</th>}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k} className="border-b border-line-soft last:border-0">
                <th scope="row" className="py-2.5 text-left font-normal">{metricDef(k).label}</th>
                <td className="py-2.5 text-right">{formatMetric(k, month.totals[k], currency)}</td>
                {prev && <td className="py-2.5 text-right text-ink-2">{formatMetric(k, prev.totals[k], currency)}</td>}
                {prev && (
                  <td className="py-2.5 text-right">
                    <Change change={pctChange(month.totals[k], prev.totals[k])} higherIsBetter={metricDef(k).higherIsBetter} suffix="" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* ================= copy ================= */

function headline(m: MonthData, prev: MonthData | undefined, currency: string): string {
  const name = monthLabel(m.month).split(" ")[0];
  const lead = ["revenue", "leads", "conversions", "calls", "conversations", "clicks", "sessions"].find((k) => m.totals[k] != null);
  if (!lead) return `${name}’s results are in.`;
  const value = formatMetric(lead, m.totals[lead], currency);
  const noun: Record<string, string> = {
    revenue: `${value} in revenue`, leads: `${value} new leads`, conversions: `${value} conversions`, calls: `${value} calls`,
    conversations: `${value} conversations`, clicks: `${value} clicks`, sessions: `${value} website visits`,
  };
  const base = `${name} brought in ${noun[lead]}`;
  const ch = pctChange(m.totals[lead], prev?.totals[lead]);
  if (ch == null || !prev) return `${base}.`;
  const prevName = monthLabel(prev.month).split(" ")[0];
  if (Math.abs(ch) < 0.005) return `${base}, level with ${prevName}.`;
  return `${base}, ${Math.round(Math.abs(ch) * 100) || "<1"}% ${ch > 0 ? "more" : "fewer"} than ${prevName}.`.replace("% fewer than", lead === "revenue" ? "% less than" : "% fewer than");
}
