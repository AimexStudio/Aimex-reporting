/**
 * Task report logic, ported line for line from the clickup-my-tasks.html prototype.
 * Pure (no DOM, no fetch), so it runs in the browser and the figures match the prototype.
 */
import type { CUField, CUOption, CUTask } from "./clickup";

export const DAY = 864e5;
export const PRIORITY_ORDER: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4, none: 5 };

export interface FieldDef { name: string; type: string; options: CUOption[] }
export interface GroupOption { value: string; label: string }

export interface Task {
  id: string; name: string; url: string; raw: CUTask;
  status: string; color: string; order: number;
  closed: boolean; due: number | null; doneAt: number | null;
  created: number | null; priority: string;
  list: string; folder: string; contractor: string;
  updated: number; overdue: boolean; progress: number | null; onTime: boolean | null;
}

/* Grouping source: a custom field if one exists, otherwise list, folder, tag or assignee */
export function buildGroupOptions(raw: CUTask[], prev?: string) {
  const fields = new Map<string, FieldDef>();
  for (const t of raw) for (const f of t.custom_fields || [])
    if (["drop_down", "labels", "users", "short_text", "text"].includes(f.type)) fields.set(f.id, { name: f.name, type: f.type, options: f.type_config?.options || [] });
  const opts: GroupOption[] = [...[...fields].map(([id, f]) => ({ value: `cf:${id}`, label: `Field: ${f.name}` })),
    { value: "list", label: "List" }, { value: "folder", label: "Folder" }, { value: "tag", label: "Tag" }, { value: "assignee", label: "Assignee" }];
  const list = [...fields];
  const isProduction = (f: FieldDef) => /production/i.test(f.name);
  const isTagField = (f: FieldDef) => f.type === "labels" || f.type === "drop_down";
  const guess = list.find(([, f]) => isProduction(f) && isTagField(f)) || list.find(([, f]) => isProduction(f));
  const value = prev && opts.some((o) => o.value === prev) ? prev : guess ? `cf:${guess[0]}` : "list";
  return { fieldDefs: fields, options: opts, value, foundProduction: !!guess };
}

export function contractorOf(t: CUTask, g: string): string {
  if (g === "list") return t.list?.name || "";
  if (g === "folder") return t.folder?.hidden ? "" : t.folder?.name || "";
  if (g === "tag") return (t.tags || []).map((x) => x.name).join(", ");
  if (g === "assignee") return (t.assignees || []).map((a) => a.username).join(", ");
  const f = (t.custom_fields || []).find((f) => `cf:${f.id}` === g);
  if (!f || f.value == null || f.value === "") return "";
  const opts = f.type_config?.options || [];
  if (f.type === "drop_down") { const o = opts.find((o) => o.orderindex === Number(f.value) || o.id === f.value); return o?.name || ""; }
  if (f.type === "labels") return ((f.value as string[]) || []).map((id) => opts.find((o) => o.id === id)?.label).filter(Boolean).join(", ");
  if (f.type === "users") return ((f.value as { username?: string }[]) || []).map((u) => u.username).join(", ");
  return String(f.value);
}

export function progressOf(t: CUTask): number | null {
  const f = (t.custom_fields || []).find((f) => /progress/i.test(f.type) || /progress/i.test(f.name));
  if (!f || f.value == null || f.value === "") return null;
  const v = f.value as number | { percent_completed?: number; current?: number };
  if (typeof v === "number") return Math.round(v);
  if (v.percent_completed != null) return Math.round(Number(v.percent_completed));
  const c = f.type_config || {};
  if (v.current != null && c.end != null) {
    const start = Number(c.start || 0), end = Number(c.end);
    return end > start ? Math.round((Number(v.current) - start) / (end - start) * 100) : null;
  }
  return null;
}

export function normalise(t: CUTask, g: string, now = Date.now()): Task {
  const type = t.status?.type || "open";
  const closed = type === "closed" || type === "done";
  const due = t.due_date ? Number(t.due_date) : null;
  const doneAt = closed ? Number(t.date_closed || t.date_done || t.date_updated) || null : null;
  return {
    id: t.id, name: t.name, url: t.url, raw: t,
    status: t.status?.status || "unknown", color: t.status?.color || "#9ca3af", order: t.status?.orderindex ?? 99,
    closed, due, doneAt,
    created: Number(t.date_created) || null,
    priority: t.priority?.priority || "none",
    list: t.list?.name || "", folder: t.folder?.hidden ? "" : (t.folder?.name || ""),
    contractor: contractorOf(t, g) || "Not set",
    updated: Number(t.date_updated) || 0,
    overdue: !closed && due !== null && due < now,
    progress: progressOf(t),
    onTime: closed && due ? (doneAt as number) <= due + DAY : null,
  };
}

/** The colour and stage order of a group value, when grouping by a field with options. */
export function optionMeta(field: FieldDef | null, name: string) {
  if (!field || !field.options.length) return null;
  const o = field.options.find((o) => (o.name || o.label) === name);
  return o ? { color: o.color || "#9ca3af", order: o.orderindex ?? 0 } : null;
}

/** Every custom field with a value, formatted for reading. */
export type FieldText = { text: string; color?: string; href?: string } | null;
export function fieldValue(f: CUField): FieldText {
  const v = f.value as any;
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  const opts = f.type_config?.options || [];
  switch (f.type) {
    case "drop_down": { const o = opts.find((o) => o.orderindex === Number(v) || o.id === v); return o ? { text: o.name || "", color: o.color || undefined } : null; }
    case "labels": { const s = (v as string[]).map((id) => opts.find((o) => o.id === id)?.label).filter(Boolean).join(", "); return s ? { text: s } : null; }
    case "users": return { text: (v as { username?: string; email?: string }[]).map((u) => u.username || u.email).join(", ") };
    case "date": return { text: fmt(Number(v)) };
    case "checkbox": return v === true || v === "true" ? { text: "Yes" } : null;
    case "url": return { text: String(v), href: String(v) };
    case "email": return { text: String(v), href: `mailto:${v}` };
    case "location": return { text: v.formatted_address || "" };
    case "attachment": return { text: `${v.length} ${plural(v.length, "file")}` };
    case "progress": case "automatic_progress": { const p = v.percent_completed ?? null; return p == null ? null : { text: `${Math.round(p)}%` }; }
    case "currency": case "number": case "emoji": return { text: String(v) };
    default: return typeof v === "object" ? null : { text: String(v) };
  }
}

export function groupBy<T, K>(arr: T[], fn: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); }
  return m;
}
export function startOfWeek(ms: number) { const d = new Date(ms); d.setHours(0, 0, 0, 0); const day = (d.getDay() + 6) % 7; return d.getTime() - day * DAY; }
export const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const plural = (n: number, w: string) => (n === 1 ? w : w + "s");
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export function ago(ms: number, now = Date.now()) {
  if (!ms) return "";
  const d = Math.floor((now - ms) / DAY);
  if (d <= 0) { const h = Math.floor((now - ms) / 36e5); return h <= 0 ? "just now" : `${h}h ago`; }
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return fmt(ms);
}

/** The search test used everywhere on the page: task name, list, folder or group value. */
export const matches = (t: Task, q: string) => !q || [t.name, t.list, t.folder, t.contractor].some((v) => v.toLowerCase().includes(q));
