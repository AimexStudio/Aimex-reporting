"use client";

/** On-brand charts for the client report. Orange, navy and greys only. */
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatMetric, formatPercent, monthLabel } from "@/lib/metrics";

export const BRAND = "#E54019";
export const NIGHT = "#0E1320";
export const PALETTE = [BRAND, NIGHT, "#F08A6E", "#8A94A6", "#F7C4B4", "#4B5563", "#B8BFCC"];
const GREY = "#C9CED8";
const AXIS = { fill: "#8A94A6", fontSize: 12 };
const tooltipStyle = { borderRadius: 10, border: "1px solid #E2E5EA", fontFamily: "inherit", fontSize: 13 };
const legendStyle = { fontSize: 13, paddingTop: 8 };
/** Legend labels in readable ink rather than each series' (sometimes pale) colour. */
const legendText = (label: string) => <span style={{ color: "#4B5563" }}>{label}</span>;

/* ---------- donut ---------- */

export function Donut({ data, format, centerValue, centerLabel, colors }: {
  data: { name: string; value: number }[];
  format: (v: number) => string;
  centerValue?: string;
  centerLabel?: string;
  /** Optional colour per item of `data` (same order); defaults to the brand palette. */
  colors?: string[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const palette = colors ? data.map((d, i) => ({ d, c: colors[i] })).filter((x) => x.d.value > 0).map((x) => x.c) : PALETTE;
  const rows = data.filter((d) => d.value > 0);
  if (!rows.length) return null;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto size-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={rows.length > 1 ? 2 : 0} stroke="none" startAngle={90} endAngle={-270}>
              {rows.map((_, i) => <Cell key={i} fill={palette[i % palette.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${format(Number(v))} (${formatPercent(Number(v) / total, 0)})`, n]} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue && (
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <span className="num text-xl leading-none">{centerValue}</span>
            {centerLabel && <span className="mt-1 text-xs text-ink-3">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="grid gap-2 text-sm">
        {rows.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-3 shrink-0 rounded-sm" style={{ background: palette[i % palette.length] }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="shrink-0 text-ink-2"><span className="num text-ink">{formatPercent(d.value / total, 0)}</span> {format(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- share of spend vs share of results ---------- */

export function SharePairs({ rows, noun }: { rows: { label: string; spend: number; outcome: number }[]; noun: string }) {
  if (rows.length < 2) return null;
  const data = rows.map((r) => ({ label: r.label.length > 22 ? r.label.slice(0, 21) + "…" : r.label, full: r.label, spend: r.spend, outcome: r.outcome }));
  return (
    <div className="w-full" style={{ height: data.length * 56 + 56 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barGap={3} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke="#EEF0F3" />
          <XAxis type="number" domain={[0, (max: number) => Math.min(1, Math.ceil(max * 10) / 10 || 0.1)]} tickFormatter={(v: number) => formatPercent(v, 0)} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={128} tick={{ ...AXIS, fill: "#4B5563" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F3F4F6" }}
            labelFormatter={(_, p) => p?.[0]?.payload?.full ?? ""}
            formatter={(v, n) => [formatPercent(Number(v), 0), n]} />
          <Legend wrapperStyle={legendStyle} iconType="square" formatter={(v) => legendText(String(v))} />
          <Bar dataKey="spend" name="Share of spend" fill={GREY} radius={[0, 4, 4, 0]} />
          <Bar dataKey="outcome" name={`Share of ${noun}`} fill={BRAND} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- results by age, with cost per result ---------- */

export function AgeChart({ rows, noun, currency }: { rows: { age: string; outcome: number; costPer: number | null }[]; noun: string; currency: string }) {
  if (rows.length < 2) return null;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#EEF0F3" />
          <XAxis dataKey="age" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <YAxis yAxisId="r" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={64}
            tickFormatter={(v: number) => formatMetric("cpl", v, currency, { axis: true })} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F3F4F6" }}
            formatter={(v, n) => [n === "costPer" ? formatMetric("cpl", Number(v), currency) : String(v), n === "costPer" ? `Cost per ${noun.replace(/s$/, "")}` : noun[0].toUpperCase() + noun.slice(1)]} />
          <Legend wrapperStyle={legendStyle} iconType="square" formatter={(v) => legendText(v === "costPer" ? `Cost per ${noun.replace(/s$/, "")}` : noun[0].toUpperCase() + noun.slice(1))} />
          <Bar yAxisId="l" dataKey="outcome" fill={BRAND} radius={[6, 6, 0, 0]} maxBarSize={48} />
          <Line yAxisId="r" dataKey="costPer" stroke={NIGHT} strokeWidth={2.5} dot={{ r: 4, fill: NIGHT }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- money in, results out (by month) ---------- */

export function SpendVsOutcome({ rows, outcomeLabel, currency, outcomeKey }: {
  rows: { month: string; spend?: number; outcome?: number }[]; outcomeLabel: string; currency: string; outcomeKey: string;
}) {
  const data = rows.map((r) => ({ ...r, label: monthLabel(r.month, "short") }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#EEF0F3" />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis yAxisId="l" tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatMetric("spend", v, currency, { axis: true })} />
          <YAxis yAxisId="r" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => formatMetric(outcomeKey, v, currency, { axis: true })} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#F3F4F6" }}
            labelFormatter={(_, p) => (p?.[0]?.payload?.month ? monthLabel(p[0].payload.month) : "")}
            formatter={(v, n) => [n === "spend" ? formatMetric("spend", Number(v), currency) : formatMetric(outcomeKey, Number(v), currency), n === "spend" ? "Invested" : outcomeLabel]} />
          <Legend wrapperStyle={legendStyle} iconType="square" formatter={(v) => legendText(v === "spend" ? "Invested" : outcomeLabel)} />
          <Bar yAxisId="l" dataKey="spend" fill={GREY} radius={[6, 6, 0, 0]} maxBarSize={40} />
          <Line yAxisId="r" dataKey="outcome" stroke={BRAND} strokeWidth={3} dot={{ r: 4, fill: BRAND }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostTrend({ rows, metric, currency, label }: { rows: { month: string; value?: number }[]; metric: string; currency: string; label: string }) {
  const data = rows.map((r) => ({ ...r, label: monthLabel(r.month, "short") }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#EEF0F3" />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatMetric(metric, v, currency, { axis: true })} />
          <Tooltip contentStyle={tooltipStyle}
            labelFormatter={(_, p) => (p?.[0]?.payload?.month ? monthLabel(p[0].payload.month) : "")}
            formatter={(v) => [formatMetric(metric, Number(v), currency), label]} />
          <Line dataKey="value" stroke={NIGHT} strokeWidth={3} dot={{ r: 4, fill: NIGHT }} activeDot={{ r: 6, fill: BRAND }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
