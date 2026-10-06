"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DashboardData, MonthData } from "@/lib/data";
import { formatMetric, formatPercent, monthLabel } from "@/lib/metrics";
import { outcomeMetric, outcomeNoun } from "@/lib/insights";
import { ReportBody } from "./Dashboard";
import { BreakdownTable, GoalsSection, NotesPanel, Roadmap, RoiPlanner } from "./ReportSections";
import { FullscreenButton, PrintButton } from "./ReportTools";

type Section = { id: string; label: string; icon: string };

/** Everything that differs per company in a group: where its report lives. */
export interface CompanyLink { id: string; name: string; href: string }

/**
 * The client report: a sidebar (logo, period, companies, sections) and the chosen section.
 * Sections: Overview, one page per channel, Goals and the ROI planner (when they apply).
 */
export function ReportApp({ data, companies, currentCompany, manageHref, signOut }: {
  data: DashboardData;
  companies: CompanyLink[];
  currentCompany: string;
  manageHref?: string | null;
  signOut?: React.ReactNode;
}) {
  const { months, client, settings } = data;
  const cur = client.currency;
  const group = data.scope.kind === "overview";
  const [selected, setSelected] = useState(months.at(-1)?.month ?? "");
  const [section, setSection] = useState("overview");
  const month = months.find((m) => m.month === selected);

  const channels = useMemo(
    () => (group ? [] : [...new Set(months.flatMap((m) => m.channels.map((c) => c.channel)))]),
    [months, group],
  );
  const goals = settings.goals ?? [];
  const milestones = settings.milestones ?? [];
  const hasSpend = months.some((m) => (m.totals.spend ?? 0) > 0);
  const sections: Section[] = [
    { id: "overview", label: group ? "Group overview" : "Overview", icon: "grid" },
    ...channels.map((c) => ({ id: `ch:${c}`, label: c, icon: /meta|facebook|instagram/i.test(c) ? "people" : /google/i.test(c) ? "search" : "chart" })),
    ...(goals.length ? [{ id: "goals", label: "Goals", icon: "target" }] : []),
    ...(!group && hasSpend ? [{ id: "roi", label: "ROI planner", icon: "calc" }] : []),
  ];
  const active = sections.some((s) => s.id === section) ? section : "overview";

  const scopeName = group ? "All companies" : data.scope.name !== client.name ? data.scope.name : null;
  const channelName = active.startsWith("ch:") ? active.slice(3) : null;
  const channelMonths = useMemo(() => (channelName ? scopeToChannel(months, channelName) : []), [months, channelName]);
  const chips = headlineChips(channelName ? channelMonths.find((m) => m.month === selected) : month, cur);

  return (
    <div className="report-root min-h-dvh bg-page lg:grid lg:grid-cols-[272px_minmax(0,1fr)] print:block">
      {/* ---------- sidebar (dark column runs the full page height; the menu stays in view) ---------- */}
      <div className="bg-night print:hidden">
      <aside className="flex flex-col bg-night text-white lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 lg:block lg:px-6 lg:pt-7">
          {client.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={client.logo} alt={client.name} className="h-12 w-auto max-w-[200px] rounded-lg bg-white/95 object-contain p-1.5 lg:mx-auto lg:h-16" />
          ) : (
            <p className="text-lg font-semibold leading-tight lg:text-center">{client.name}</p>
          )}
          <p className="text-xs text-white/50 lg:mt-3 lg:text-center">Marketing report by Aimex Studio</p>
        </div>

        {selected && (
          <div className="mx-5 mt-5 rounded-xl bg-white/[0.06] p-3 text-sm ring-1 ring-white/10 lg:mx-4">
            <p className="text-xs text-white/50">Reporting period</p>
            <p className="font-semibold">{periodText(selected)}</p>
          </div>
        )}

        {companies.length > 1 && (
          <label className="mx-5 mt-4 grid gap-1 text-xs text-white/50 lg:mx-4">
            Company
            <select className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white ring-1 ring-white/15 [&>option]:text-ink" value={currentCompany}
              onChange={(e) => { const c = companies.find((x) => x.id === e.target.value); if (c) window.location.href = c.href; }}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}

        <nav aria-label="Report sections" className="mt-4 flex gap-1 overflow-x-auto px-5 pb-4 lg:mt-6 lg:flex-col lg:px-4">
          {sections.map((s) => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={s.id === active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium ${s.id === active ? "bg-brand text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`}>
              <NavIcon name={s.icon} />
              {s.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto hidden border-t border-white/10 px-4 py-4 lg:block">
          {manageHref && <Link href={manageHref} className="mb-2 flex rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10">Manage this client’s data</Link>}
          {signOut}
        </div>
      </aside>
      </div>

      {/* ---------- main ---------- */}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur print:static print:border-0">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5 sm:px-8 lg:px-12">
            <div className="flex min-w-0 items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-color.png" alt="Aimex Studio" className="hidden h-7 w-auto print:block" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{client.name}{scopeName && !group ? `: ${scopeName}` : group ? ": all companies" : ""}</p>
                <p className="truncate text-xs text-ink-3">Marketing analytics{channelName ? `, ${channelName}` : ""}{selected ? `, ${monthLabel(selected)}` : ""}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {chips.map((c) => (
                <div key={c.label} className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-ink-3">{c.label}</p>
                  <p className={`num text-base ${c.accent ? "text-good" : "text-ink"}`}>{c.value}</p>
                </div>
              ))}
              <div className="flex items-center gap-2 print:hidden [&_button]:text-ink [&_button]:ring-line [&_button:hover]:bg-page">
                <FullscreenButton />
                <PrintButton />
                <div className="lg:hidden">{signOut}</div>
              </div>
            </div>
          </div>
          {manageHref && (
            <div className="border-t border-line bg-brand-soft px-5 py-1.5 text-sm sm:px-8 lg:hidden print:hidden">
              <Link href={manageHref} className="font-medium text-brand-strong underline">Manage this client’s data</Link>
            </div>
          )}
        </header>

        {active === "overview" && (
          <ReportBody months={months} currency={cur} selected={selected} onSelect={setSelected} scopeName={scopeName}
            unit={group ? "company" : "channel"} showWorked={false} benchmark={settings.benchmark}
            slots={{
              afterHero: <NotesPanel notes={month?.sectionNotes.overview} title="Overview" />,
              beforeNumbers: <Roadmap milestones={milestones} />,
            }} />
        )}
        {channelName && (
          <ReportBody months={channelMonths} currency={cur} selected={selected} onSelect={setSelected} scopeName={channelName}
            unit="channel" showWorked benchmark={settings.benchmark}
            slots={{
              afterHero: <NotesPanel notes={month?.sectionNotes[channelName]} title={channelName} />,
              afterTiles: (() => {
                const b = channelMonths.find((m) => m.month === selected)?.channels[0]?.breakdowns;
                return b ? <BreakdownTable b={b} currency={cur} /> : null;
              })(),
            }} />
        )}
        {active === "goals" && (
          <SectionPage title="Goals" selected={selected} months={months} onSelect={setSelected}>
            <GoalsSection goals={goals} months={months} selected={selected} currency={cur} />
          </SectionPage>
        )}
        {active === "roi" && (
          <SectionPage title="ROI planner" selected={selected} months={months} onSelect={setSelected}>
            <RoiPlanner key={selected} month={month} currency={cur} roi={settings.roi} />
          </SectionPage>
        )}

        <footer className="px-5 pb-12 pt-4 text-sm text-ink-3 sm:px-8 lg:px-12">
          Prepared by Aimex Studio. Results are updated monthly. Questions about a number? Contact your account manager.
          <PrintedOn />
        </footer>
      </div>
    </div>
  );
}

function SectionPage({ title, selected, months, onSelect, children }: {
  title: string; selected: string; months: MonthData[]; onSelect: (m: string) => void; children: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-6 px-5 py-10 sm:px-8 lg:px-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {months.length > 1 && (
          <select className="input w-auto py-1.5 text-sm print:hidden" value={selected} onChange={(e) => onSelect(e.target.value)} aria-label="Month">
            {[...months].reverse().map((m) => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)}
          </select>
        )}
      </div>
      {children}
    </main>
  );
}

/** One channel's view of every month: its own figures as the totals, and its breakdowns. */
function scopeToChannel(months: MonthData[], channel: string): MonthData[] {
  return months.flatMap((m) => {
    const c = m.channels.find((x) => x.channel === channel);
    return c ? [{ ...m, totals: c.metrics, channels: [c], note: null, compareNote: undefined }] : [];
  });
}

function headlineChips(m: MonthData | undefined, currency: string) {
  if (!m) return [];
  const out = outcomeMetric(m.totals);
  const chips: { label: string; value: string; accent?: boolean }[] = [];
  if (out && m.totals.spend) {
    const key = out === "leads" ? "cpl" : out === "conversions" ? "cpa" : null;
    const cost = key ? m.totals[key] : m.totals.spend / m.totals[out];
    if (cost != null) chips.push({ label: `Blended cost per ${outcomeNoun(out, 1)}`, value: formatMetric("cpl", cost, currency) });
  }
  if (out) {
    // conversion rate only from channels that report both clicks and this outcome
    const scoped = m.channels.filter((c) => c.metrics.clicks && c.metrics[out] != null);
    const clicks = scoped.reduce((s, c) => s + (c.metrics.clicks ?? 0), 0);
    const results = scoped.reduce((s, c) => s + (c.metrics[out] ?? 0), 0);
    if (clicks > 0) chips.push({ label: `Click to ${outcomeNoun(out, 1)} rate${scoped.length < m.channels.length ? ` (${scoped.map((c) => c.channel).join(", ")})` : ""}`, value: formatPercent(results / clicks, 2), accent: true });
  }
  return chips;
}

function periodText(month: string) {
  const [y, mo] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const [name] = monthLabel(month).split(" ");
  return `1 – ${last} ${name} ${y}`;
}

function PrintedOn() {
  const d = new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  return <span className="hidden print:inline"> Printed {d}.</span>;
}

function NavIcon({ name }: { name: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const d: Record<string, React.ReactNode> = {
    grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" {...p} /><rect x="13" y="4" width="7" height="7" rx="1.5" {...p} /><rect x="4" y="13" width="7" height="7" rx="1.5" {...p} /><rect x="13" y="13" width="7" height="7" rx="1.5" {...p} /></>,
    people: <><circle cx="9" cy="8" r="3" {...p} /><path d="M3.5 19c.7-3 3-4.5 5.5-4.5s4.8 1.5 5.5 4.5M16 6.5a2.5 2.5 0 1 1 0 5M17.5 14.5c1.7.5 2.8 2 3 4.5" {...p} /></>,
    search: <><circle cx="11" cy="11" r="6" {...p} /><path d="m20 20-4.5-4.5" {...p} /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" {...p} /></>,
    target: <><circle cx="12" cy="12" r="8" {...p} /><circle cx="12" cy="12" r="4" {...p} /><circle cx="12" cy="12" r="0.8" {...p} /></>,
    calc: <><rect x="5" y="3" width="14" height="18" rx="2" {...p} /><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h8" {...p} /></>,
  };
  return <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">{d[name] ?? d.chart}</svg>;
}
