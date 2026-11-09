"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { TaskComment, TaskSummary } from "@/lib/clickup";
import {
  DAY, PRIORITY_ORDER, ago, buildGroupOptions, cap, fieldValue, fmt, groupBy, matches, normalise, optionMeta,
  plural, shortDate, startOfWeek, type FieldDef, type Task,
} from "@/lib/task-report";

const API = "/admin/task-report/api";
const LATE = "var(--color-brand)";   // overdue or finished late, only
const DONE = "var(--color-good)";    // completed work
const BAR = "var(--color-night-3)";  // neutral columns
const NODATE = "var(--color-ink-3)";
const card = "rounded-2xl border border-line bg-surface";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type CommentState = { list: TaskComment[] } | { error: true };

export function TaskReport() {
  const [data, setData] = useState<TaskSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [groupValue, setGroupValue] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const comments = useRef(new Map<string, CommentState>());
  const [, setTick] = useState(0); // re-render when a comment arrives
  const queueRun = useRef(0);

  const load = useCallback(async (refresh = false) => {
    setRefreshing(true); setError(null);
    try {
      const res = await fetch(`${API}/summary${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `The Admin Report returned ${res.status}.`);
      queueRun.current++; comments.current.clear(); setExpanded(new Set()); setFilter(null);
      setData(body as TaskSummary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const grouping = useMemo(() => (data ? buildGroupOptions(data.tasks, groupValue) : null), [data, groupValue]);
  const g = grouping?.value ?? "list";
  const field = g.startsWith("cf:") ? grouping?.fieldDefs.get(g.slice(3)) ?? null : null;
  const tasks = useMemo(() => (data ? data.tasks.map((t) => normalise(t, g)) : []), [data, g]);

  /* Latest comments: fetched in the background, a little at a time, to stay inside ClickUp's rate limit */
  const fetchComments = useCallback(async (id: string): Promise<CommentState> => {
    const have = comments.current.get(id);
    if (have) return have;
    const res = await fetch(`${API}/comments/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 429) throw new Error("429");
    const v: CommentState = res.ok ? { list: (await res.json()).comments as TaskComment[] } : { error: true };
    comments.current.set(id, v);
    return v;
  }, []);
  useEffect(() => {
    if (!data) return;
    const run = ++queueRun.current;
    const order = tasks.filter((t) => !t.closed && !comments.current.has(t.id))
      .sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || ((a.due ?? Infinity) - (b.due ?? Infinity)));
    (async () => {
      for (const t of order) {
        if (run !== queueRun.current) return;
        if (comments.current.has(t.id)) continue;
        try { await fetchComments(t.id); }
        catch { await sleep(30000); if (run !== queueRun.current) return; try { await fetchComments(t.id); } catch { comments.current.set(t.id, { error: true }); } }
        setTick((x) => x + 1);
        await sleep(700);
      }
    })();
    return () => { queueRun.current++; };
    // the queue restarts only when new data arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function toggleDetails(id: string) {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
    if (next.has(id) && !comments.current.has(id)) {
      try { await fetchComments(id); } catch { comments.current.set(id, { error: true }); }
      setTick((x) => x + 1);
    }
  }

  if (error && !data) {
    return <div className={`${card} p-6`}><p role="alert" className="text-neg">{error}</p>
      <button className="btn mt-4" onClick={() => load(true)} disabled={refreshing}>{refreshing ? "Refreshing…" : "Try again"}</button></div>;
  }
  if (!data || !grouping) return <p className="text-ink-2">Loading…</p>;

  const query = q.trim().toLowerCase();
  const now = Date.now();
  const scoped = tasks.filter((t) => (!filter || t.contractor === filter) && matches(t, query));
  const open = scoped.filter((t) => !t.closed);
  const late = open.filter((t) => t.overdue);
  const week = open.filter((t) => t.due && !t.overdue && t.due <= now + 7 * DAY);
  const done30 = scoped.filter((t) => t.closed && (t.doneAt as number) >= now - 30 * DAY);
  const withDue = scoped.filter((t) => t.onTime !== null && (t.doneAt as number) >= now - 90 * DAY);
  const onTimePct = withDue.length ? Math.round(withDue.filter((t) => t.onTime).length / withDue.length * 100) : null;
  const groupLabel = grouping.options.find((o) => o.value === g)?.label.replace(/^Field: /, "") ?? "Group";
  const pick = (n: string) => setFilter((f) => (f === n ? null : n));
  const dot = (name: string) => { const m = optionMeta(field, name); return m ? <Dot color={m.color} /> : null; };
  const hasProgress = tasks.some((t) => t.progress != null);
  const showGroupCol = g !== "list";

  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      {/* 1. Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Admin Report</h1>
          <p className="mt-1 text-ink-2">
            {!open.length ? "No open work. Everything is complete." : `${open.length} open ${plural(open.length, "task")}, ${late.length} overdue and ${week.length} due this week.`}
          </p>
        </div>
        <button className="btn" onClick={() => load(true)} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-sm text-neg">{error}</p>}

      {/* 2. Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" className="input w-64 max-w-full" placeholder="Search tasks or lists" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-ink-2">Group by</span>
        <select className="input w-auto" aria-label="Group tasks by" value={g} onChange={(e) => { setGroupValue(e.target.value); setFilter(null); }}>
          {grouping.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {filter && <button className="rounded-full bg-night px-3 py-1.5 text-sm font-medium text-white" onClick={() => setFilter(null)}>{filter}&nbsp;&nbsp;✕</button>}
        <span className="ml-auto text-sm text-ink-3">Updated {new Date(data.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      {!grouping.foundProduction && (
        <p className="rounded-lg bg-line-soft px-3 py-2 text-sm text-ink-2">No custom field called “Production” was found on these tasks, so they’re grouped by list. Check the field is added to the lists these tasks live in.</p>
      )}

      {/* 3. Key numbers */}
      <div role="group" aria-label="Key numbers" className={`${card} grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 [&>div]:p-5`}>
        {([["Open tasks", open.length], ["Overdue", late.length, late.length > 0], ["Due in 7 days", week.length],
          ["Completed, last 30 days", done30.length], ["On time, last 90 days", onTimePct === null ? "–" : `${onTimePct}%`]] as const).map(([l, n, isLate]) => (
          <div key={l}><span className={`num block text-3xl leading-none ${isLate ? "text-brand-strong" : ""}`}>{n}</span><span className="mt-2 block text-sm text-ink-2">{l}</span></div>
        ))}
      </div>

      {/* 4. Production pipeline */}
      <Pipeline tasks={tasks} query={query} field={field} filter={filter} onPick={pick} />

      {/* 5. Two charts */}
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <StatusCard open={open} />
        <div className={`${card} p-6`}>
          <h3 className="font-semibold">Due dates ahead</h3>
          <p className="mb-3 mt-0.5 text-sm text-ink-2">Open tasks by due week. Overdue work is shown first.</p>
          <Columns data={dueBuckets(open)} />
        </div>
      </div>

      {/* 6. Completed per week */}
      <DoneCard scoped={scoped} />

      {/* 7. Breakdown */}
      <Breakdown tasks={tasks} query={query} groupLabel={groupLabel} field={field} filter={filter} onPick={pick} dot={dot} />

      {/* 8. Task tables by status */}
      {[...groupBy(scoped, (t) => t.status).values()].sort((a, b) => Number(a[0].closed) - Number(b[0].closed) || a[0].order - b[0].order).map((items) => {
        const s = items[0];
        items.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
        const hide = collapsed.has(s.status) || (s.closed && !collapsed.has("open:" + s.status));
        const toggle = () => setCollapsed((c) => { const n = new Set(c); const k = s.closed ? "open:" + s.status : s.status; n.has(k) ? n.delete(k) : n.add(k); return n; });
        const cols = 6 + (showGroupCol ? 1 : 0) + (hasProgress ? 1 : 0);
        return (
          <section key={s.status}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><Dot color={s.color} />{cap(s.status)}<span className="text-base font-normal text-ink-3">{items.length}</span></h2>
              <button className="text-sm font-medium text-brand-strong hover:underline" onClick={toggle}>{hide ? "Show" : "Hide"}</button>
            </div>
            {!hide && (
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full min-w-[860px] text-sm">
                  <thead><tr className="border-b border-line text-left text-ink-2">
                    <th className="px-4 py-3 font-medium">Task</th>{showGroupCol && <th className="px-4 py-3 font-medium">{groupLabel}</th>}
                    <th className="px-4 py-3 font-medium">List</th><th className="px-4 py-3 font-medium">Priority</th><th className="px-4 py-3 font-medium">Due</th>
                    {hasProgress && <th className="px-4 py-3 font-medium">Progress</th>}<th className="px-4 py-3 font-medium">Last updated</th><th className="px-4 py-3" />
                  </tr></thead>
                  <tbody>
                    {items.map((t) => (
                      <TaskRow key={t.id} t={t} now={now} showGroupCol={showGroupCol} hasProgress={hasProgress} cols={cols} dot={dot}
                        comment={comments.current.get(t.id)} open={expanded.has(t.id)} onDetails={() => toggleDetails(t.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

const Dot = ({ color }: { color: string }) => <span className="mr-2 inline-block size-2.5 shrink-0 rounded-full align-middle" style={{ background: color }} />;

function Pipeline({ tasks, query, field: f, filter, onPick }: {
  tasks: Task[]; query: string; field: FieldDef | null; filter: string | null; onPick: (n: string) => void;
}) {
  if (!f || f.type !== "drop_down" || !f.options.length) return null;
  const open = tasks.filter((t) => !t.closed && matches(t, query));
  const stages = [...f.options].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0)).map((o) => ({ name: o.name || "", color: o.color || "#9ca3af" }));
  if (open.some((t) => t.contractor === "Not set")) stages.push({ name: "Not set", color: "var(--color-ink-3)" });
  const withP = open.filter((t) => t.progress != null);
  const avg = withP.length ? Math.round(withP.reduce((s, t) => s + (t.progress as number), 0) / withP.length) : null;
  return (
    <div className={`${card} p-6`}>
      <h3 className="font-semibold">{f.name}</h3>
      <p className="mb-4 mt-0.5 text-sm text-ink-2">
        {`Where ${open.length} open ${plural(open.length, "task")} sit in production, in stage order.` + (avg != null ? ` Average progress is ${avg}%.` : "") + " Select a stage to filter the page."}
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
        {stages.map((st) => {
          const ts = open.filter((t) => t.contractor === st.name);
          const l = ts.filter((t) => t.overdue).length;
          return (
            <button key={st.name} onClick={() => onPick(st.name)} aria-pressed={filter === st.name}
              className={`rounded-xl border border-line border-t-4 bg-surface p-4 text-left hover:bg-page ${filter === st.name ? "ring-2 ring-night" : ""}`} style={{ borderTopColor: st.color }}>
              <span className="block text-sm font-medium text-ink-2">{st.name}</span>
              <span className="num mt-1 block text-2xl">{ts.length}</span>
              <span className={`mt-1 block text-xs ${l ? "font-medium text-brand-strong" : "text-ink-3"}`}>{l ? `${l} overdue` : ts.length ? "On track" : "None"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusCard({ open }: { open: Task[] }) {
  const list = [...groupBy(open, (t) => t.status).values()].sort((a, b) => a[0].order - b[0].order);
  const total = open.length || 1;
  return (
    <div className={`${card} p-6`}>
      <h3 className="font-semibold">Where open work stands</h3>
      <p className="mb-4 mt-0.5 text-sm text-ink-2">{open.length ? `${open.length} open ${plural(open.length, "task")} across ${list.length} ${plural(list.length, "stage")}.` : "No open tasks."}</p>
      <div className="flex h-4 overflow-hidden rounded-full bg-line-soft">
        {list.map((g) => <span key={g[0].status} title={`${cap(g[0].status)}: ${g.length}`} style={{ flex: g.length, background: g[0].color }} />)}
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        {list.map((g) => (
          <div key={g[0].status} className="grid grid-cols-[1fr_auto_3.5rem] items-center gap-3">
            <span><Dot color={g[0].color} />{cap(g[0].status)}</span>
            <b className="font-semibold">{g.length}</b>
            <span className="text-right text-ink-3">{Math.round(g.length / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function dueBuckets(open: Task[]) {
  const start = startOfWeek(Date.now());
  const buckets: { label: string; n: number; color: string }[] = [{ label: "Overdue", n: open.filter((t) => t.overdue).length, color: LATE }];
  for (let i = 0; i < 8; i++) {
    const a = start + i * 7 * DAY, b = a + 7 * DAY;
    buckets.push({ label: i === 0 ? "This wk" : shortDate(a), n: open.filter((t) => !t.overdue && (t.due as number) >= a && (t.due as number) < b).length, color: BAR });
  }
  buckets.push({ label: "No date", n: open.filter((t) => !t.due).length, color: NODATE });
  return buckets;
}

function DoneCard({ scoped }: { scoped: Task[] }) {
  const start = startOfWeek(Date.now()) - 11 * 7 * DAY;
  const buckets = [];
  for (let i = 0; i < 12; i++) {
    const a = start + i * 7 * DAY, b = a + 7 * DAY;
    const wk = scoped.filter((t) => t.closed && (t.doneAt as number) >= a && (t.doneAt as number) < b);
    const lateN = wk.filter((t) => t.onTime === false).length;
    buckets.push({ label: shortDate(a), n: wk.length, late: lateN, ok: wk.length - lateN });
  }
  const total = buckets.reduce((s, b) => s + b.n, 0);
  return (
    <div className={`${card} p-6`}>
      <h3 className="font-semibold">Completed per week</h3>
      <p className="mb-3 mt-0.5 text-sm text-ink-2">{`${total} ${plural(total, "task")} completed in the last 12 weeks. The orange part of each bar was finished after its due date.`}</p>
      <div className="h-48 w-full" role="img" aria-label={buckets.map((b) => `${b.label}: ${b.n}${b.late ? ` (${b.late} late)` : ""}`).join(", ")}>
        <ResponsiveContainer>
          <BarChart data={buckets} margin={{ top: 18, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} interval={0} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v, k) => [v, k === "late" ? "Finished late" : "On time"]} />
            <Bar dataKey="ok" stackId="w" fill={DONE} isAnimationActive={false} />
            <Bar dataKey="late" stackId="w" fill={LATE} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="n" position="top" style={{ fontSize: 12, fontWeight: 600, fill: "var(--color-ink)" }} formatter={(v) => (v ? String(v) : "")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Columns({ data }: { data: { label: string; n: number; color: string }[] }) {
  return (
    <div className="h-52 w-full" role="img" aria-label={data.map((d) => `${d.label}: ${d.n}`).join(", ")}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 18, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-ink-3)" }} tickLine={false} axisLine={{ stroke: "var(--color-line)" }} interval={0} />
          <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} formatter={(v) => [v, "Tasks"]} />
          <Bar dataKey="n" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.label} fill={d.color} />)}
            <LabelList dataKey="n" position="top" style={{ fontSize: 12, fontWeight: 600, fill: "var(--color-ink)" }} formatter={(v) => (v ? String(v) : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Breakdown({ tasks, query, groupLabel, field, filter, onPick, dot }: {
  tasks: Task[]; query: string; groupLabel: string; field: FieldDef | null;
  filter: string | null; onPick: (n: string) => void; dot: (n: string) => React.ReactNode;
}) {
  const pool = tasks.filter((t) => matches(t, query));
  const now = Date.now();
  const rows = [...groupBy(pool, (t) => t.contractor).entries()].map(([name, ts]) => {
    const open = ts.filter((t) => !t.closed);
    const done = ts.filter((t) => t.closed);
    const late = open.filter((t) => t.overdue);
    const nextDue = open.filter((t) => t.due && !t.overdue).sort((a, b) => (a.due as number) - (b.due as number))[0];
    const rated = done.filter((t) => t.onTime !== null);
    return { name, total: ts.length, open: open.length, late: late.length, done: done.length,
      done30: done.filter((t) => (t.doneAt as number) >= now - 30 * DAY).length,
      onTime: rated.length ? Math.round(rated.filter((t) => t.onTime).length / rated.length * 100) : null,
      nextDue: nextDue?.due };
  }).sort((a, b) => {
    const ma = optionMeta(field, a.name), mb = optionMeta(field, b.name);
    if (ma || mb) return (ma?.order ?? 999) - (mb?.order ?? 999);
    return b.late - a.late || b.open - a.open;
  });
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">By {groupLabel.toLowerCase()}<span className="ml-2 text-base font-normal text-ink-3">{rows.length}</span></h2>
        <span className="text-sm text-ink-3">Select a row to filter the page</span>
      </div>
      <div className={`${card} overflow-x-auto`}>
        {!rows.length ? <p className="p-6 text-ink-2">No tasks to show.</p> : (
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line text-left text-ink-2">
              <th className="px-4 py-3 font-medium">{groupLabel}</th><th className="px-4 py-3 text-right font-medium">Open</th><th className="px-4 py-3 text-right font-medium">Overdue</th>
              <th className="px-4 py-3 text-right font-medium">Done, 30 days</th><th className="px-4 py-3 font-medium">Progress</th><th className="px-4 py-3 text-right font-medium">On time</th><th className="px-4 py-3 font-medium">Next due</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const donePct = r.total ? r.done / r.total * 100 : 0, latePct = r.total ? r.late / r.total * 100 : 0;
                return (
                  <tr key={r.name} tabIndex={0} onClick={() => onPick(r.name)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r.name); } }}
                    className={`cursor-pointer border-b border-line-soft last:border-0 hover:bg-page ${filter === r.name ? "bg-line-soft" : ""}`}>
                    <td className="px-4 py-3">{dot(r.name)}<b className="font-semibold">{r.name}</b><span className="ml-2 text-ink-3">{r.total} {plural(r.total, "task")}</span></td>
                    <td className="px-4 py-3 text-right">{r.open}</td>
                    <td className={`px-4 py-3 text-right ${r.late ? "font-medium text-brand-strong" : "text-ink-3"}`}>{r.late}</td>
                    <td className="px-4 py-3 text-right">{r.done30}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-2 w-28 overflow-hidden rounded-full bg-line"><i style={{ width: `${donePct}%`, background: DONE }} /><i style={{ width: `${latePct}%`, background: LATE }} /></div>
                        <b className="font-semibold">{Math.round(donePct)}%</b>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">{r.onTime === null ? <span className="text-ink-3">–</span> : `${r.onTime}%`}</td>
                    <td className="px-4 py-3">{r.nextDue ? fmt(r.nextDue) : <span className="text-ink-3">None</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function CommentLine({ c }: { c?: CommentState }) {
  if (!c) return <span className="block truncate text-xs text-ink-3">Loading latest comment…</span>;
  if ("error" in c) return <span className="block truncate text-xs text-ink-3">Couldn’t load comments</span>;
  if (!c.list.length) return <span className="block truncate text-xs text-ink-3">No comments yet</span>;
  const l = c.list[0];
  return <span className="block max-w-md truncate text-xs text-ink-2" title={l.text}><b>{l.who.split(" ")[0]}</b>, {ago(l.date)}: {l.text.replace(/\s+/g, " ")}</span>;
}

function TaskRow({ t, now, showGroupCol, hasProgress, cols, dot, comment, open, onDetails }: {
  t: Task; now: number; showGroupCol: boolean; hasProgress: boolean; cols: number; dot: (n: string) => React.ReactNode;
  comment?: CommentState; open: boolean; onDetails: () => void;
}) {
  const due = t.closed
    ? (t.due ? <>{fmt(t.due)}<span className="block text-xs text-ink-3">{t.onTime ? "Done on time" : "Done late"}</span></> : <span className="text-ink-3">No date</span>)
    : t.due ? <>{fmt(t.due)}{t.overdue && <span className="block text-xs font-medium text-brand-strong">{Math.ceil((now - t.due) / DAY)} days overdue</span>}</> : <span className="text-ink-3">No date</span>;
  return (
    <>
      <tr className="border-b border-line-soft align-top">
        <td className="max-w-md px-4 py-3">
          <a className="font-medium hover:underline" href={t.url} target="_blank" rel="noopener">{t.name}</a>
          {t.closed && !comment ? null : <CommentLine c={comment} />}
        </td>
        {showGroupCol && <td className="px-4 py-3">{dot(t.contractor)}{t.contractor}</td>}
        <td className="px-4 py-3">{t.list}{t.folder && <span className="block text-xs text-ink-3">{t.folder}</span>}</td>
        <td className="px-4 py-3">{t.priority === "none" ? <span className="text-ink-3">None</span> : cap(t.priority)}</td>
        <td className={`whitespace-nowrap px-4 py-3 ${t.overdue ? "text-brand-strong" : ""}`}>{due}</td>
        {hasProgress && <td className="px-4 py-3">{t.progress == null ? <span className="text-ink-3">–</span> : (
          <div className="flex items-center gap-2"><div className="h-2 w-20 rounded-full bg-line"><i className="block h-2 rounded-full" style={{ width: `${Math.max(0, Math.min(100, t.progress))}%`, background: DONE }} /></div><b className="font-semibold">{t.progress}%</b></div>)}</td>}
        <td className="whitespace-nowrap px-4 py-3 text-ink-3">{t.updated ? fmt(t.updated) : "Never"}</td>
        <td className="px-4 py-3"><button className="btn-quiet rounded-lg px-3 py-1 text-xs font-medium" aria-expanded={open} onClick={onDetails}>{open ? "Close" : "Details"}</button></td>
      </tr>
      {open && <tr className="border-b border-line-soft bg-page/60"><td colSpan={cols} className="px-4 py-4"><Detail t={t} c={comment} /></td></tr>}
    </>
  );
}

function Detail({ t, c }: { t: Task; c?: CommentState }) {
  const r = t.raw;
  const fields = (r.custom_fields || []).map((f) => [f.name, fieldValue(f)] as const).filter(([, v]) => v);
  const checklist = (r.checklists || []).flatMap((cl) => cl.items || []);
  const desc = (r.text_content || "").trim();
  const info = ([
    ["Assignees", (r.assignees || []).map((a) => a.username).join(", ") || null],
    ["Created", r.date_created ? fmt(Number(r.date_created)) : null],
    ["Start date", r.start_date ? fmt(Number(r.start_date)) : null],
    ["Due", t.due ? fmt(t.due) : null],
    ["Checklist", checklist.length ? `${checklist.filter((i) => i.resolved).length} of ${checklist.length} done` : null],
    ["Subtasks", r.subtasks?.length ? String(r.subtasks.length) : null],
    ["Tags", (r.tags || []).map((x) => x.name).join(", ") || null],
  ] as const).filter(([, v]) => v);
  const dl = "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm [&>dt]:text-ink-3";
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Latest comments</h4>
        {!c ? <p className="text-sm text-ink-3">Loading comments…</p>
          : "error" in c ? <p className="text-sm text-ink-3">Couldn’t load comments for this task.</p>
          : !c.list.length ? <p className="text-sm text-ink-3">No comments yet.</p>
          : <div className="grid gap-3">
              {c.list.slice(0, 3).map((x, i) => (
                <div key={i} className="rounded-lg bg-surface p-3 ring-1 ring-line">
                  <header className="mb-1 flex justify-between gap-3 text-xs"><b>{x.who}</b><span className="text-ink-3">{ago(x.date)}</span></header>
                  <p className="whitespace-pre-line text-sm">{x.text.length > 600 ? x.text.slice(0, 600) + "…" : x.text}</p>
                </div>
              ))}
              {c.list.length > 3 && <a href={t.url} target="_blank" rel="noopener" className="text-sm text-ink-3 hover:underline">{c.list.length - 3} older {plural(c.list.length - 3, "comment")} in ClickUp</a>}
            </div>}
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Fields</h4>
        {fields.length ? <dl className={dl}>{fields.map(([k, v]) => (
          <div key={k} className="contents"><dt>{k}</dt><dd>{v!.color && <Dot color={v!.color} />}{v!.href ? <a href={v!.href} target="_blank" rel="noopener" className="underline">{v!.text}</a> : v!.text}</dd></div>
        ))}</dl> : <p className="text-sm text-ink-3">No fields filled in.</p>}
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Task</h4>
        <dl className={dl}>{info.map(([k, v]) => <div key={k} className="contents"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {desc && <p className="mt-3 whitespace-pre-line text-sm text-ink-2">{desc.length > 400 ? desc.slice(0, 400) + "…" : desc}</p>}
        <p className="mt-3"><a href={t.url} target="_blank" rel="noopener" className="text-sm font-medium text-ink underline underline-offset-2">Open in ClickUp</a></p>
      </div>
    </div>
  );
}
