/**
 * ClickUp, server side only. The API token never leaves the server: it isn't sent to the
 * browser, logged or stored in the repo.
 *
 * Token lookup is kept in one function (getClickUpToken) so that later each team member's
 * own token can come from the database (encrypted) and the viewer can choose whose report
 * to see, without touching the rest of this file.
 */
import "server-only";
import crypto from "node:crypto";

const API = process.env.CLICKUP_API_URL || "https://api.clickup.com/api/v2"; // overridable only for local testing

export class ClickUpError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

/** Whose ClickUp to read. Today: the one token in CLICKUP_API_TOKEN. */
export async function getClickUpToken(_forMember?: string): Promise<string> {
  const token = process.env.CLICKUP_API_TOKEN?.trim();
  if (!token) throw new ClickUpError("ClickUp isn’t connected yet. Set CLICKUP_API_TOKEN on the server.", 503);
  return token;
}
/** A short, non-reversible key for caching per token (the token itself is never used as a key). */
const tokenKey = (t: string) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);

/* ---------- outgoing request throttle ----------
 * ClickUp allows as little as 100 requests a minute on smaller plans. Requests from this server
 * leave one at a time, at least 650 ms apart (about 92 a minute), shared by every viewer. */
const GAP_MS = 650;
let chain: Promise<void> = Promise.resolve();
let lastAt = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  });
  chain = run.catch(() => {});
  return run.then(fn);
}

async function call<T>(token: string, path: string, retried = false): Promise<T> {
  const res = await throttled(() => fetch(API + path, { headers: { Authorization: token }, cache: "no-store" }));
  if (res.status === 401) throw new ClickUpError("ClickUp rejected the API token. Check CLICKUP_API_TOKEN.", 502);
  if (res.status === 429) {
    if (retried) throw new ClickUpError("ClickUp’s rate limit was reached. Wait a minute, then refresh.", 429);
    // ClickUp says when the limit resets (unix seconds); wait for that, at most a minute.
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const wait = reset > Date.now() ? Math.min(reset - Date.now() + 250, 60_000) : 15_000;
    await new Promise((r) => setTimeout(r, wait));
    return call<T>(token, path, true);
  }
  if (!res.ok) throw new ClickUpError(`ClickUp returned ${res.status}.`, 502);
  return res.json() as Promise<T>;
}

/* ---------- small TTL caches ---------- */
type Entry<T> = { at: number; value: T };
const summaryCache = new Map<string, Entry<TaskSummary>>();
const commentCache = new Map<string, Entry<TaskComment[]>>();
const SUMMARY_TTL = 5 * 60_000;
const COMMENT_TTL = 10 * 60_000;
const fresh = <T>(e: Entry<T> | undefined, ttl: number) => (e && Date.now() - e.at < ttl ? e.value : null);

/* ---------- shapes sent to the browser (only what the report uses) ---------- */
export interface CUOption { id: string; name?: string; label?: string; color?: string | null; orderindex?: number }
export interface CUField { id: string; name: string; type: string; type_config?: { options?: CUOption[]; start?: number; end?: number }; value?: unknown }
export interface CUTask {
  id: string; name: string; url: string;
  status?: { status?: string; type?: string; color?: string; orderindex?: number };
  priority?: { priority?: string } | null;
  due_date?: string | null; start_date?: string | null; date_created?: string | null; date_updated?: string | null;
  date_closed?: string | null; date_done?: string | null;
  list?: { id?: string; name?: string } | null; folder?: { name?: string; hidden?: boolean } | null;
  tags?: { name: string }[]; assignees?: { username?: string; email?: string }[];
  custom_fields?: CUField[]; checklists?: { items?: { resolved?: boolean }[] }[];
  subtasks?: unknown[]; text_content?: string | null;
}
export interface TaskSummary {
  /** The token owner's id only: the report doesn't show their name, email or photo. */
  user: { id: number };
  workspace: string;
  tasks: CUTask[];
  fetchedAt: number;
}
export interface TaskComment { text: string; who: string; date: number }

/** Keeps every field the report reads, including custom fields with their options, and nothing else. */
function trim(t: Record<string, any>): CUTask {
  return {
    id: t.id, name: t.name, url: t.url,
    status: t.status && { status: t.status.status, type: t.status.type, color: t.status.color, orderindex: t.status.orderindex },
    priority: t.priority ? { priority: t.priority.priority } : null,
    due_date: t.due_date ?? null, start_date: t.start_date ?? null, date_created: t.date_created ?? null, date_updated: t.date_updated ?? null,
    date_closed: t.date_closed ?? null, date_done: t.date_done ?? null,
    list: t.list ? { id: t.list.id, name: t.list.name } : null,
    folder: t.folder ? { name: t.folder.name, hidden: t.folder.hidden } : null,
    tags: (t.tags ?? []).map((x: any) => ({ name: x.name })),
    assignees: (t.assignees ?? []).map((a: any) => ({ username: a.username, email: a.email })),
    custom_fields: (t.custom_fields ?? []).map((f: any) => ({
      id: f.id, name: f.name, type: f.type, value: f.value,
      type_config: f.type_config ? {
        ...(f.type_config.options ? { options: f.type_config.options.map((o: any) => ({ id: o.id, name: o.name, label: o.label, color: o.color, orderindex: o.orderindex })) } : {}),
        ...(f.type_config.start != null ? { start: f.type_config.start } : {}),
        ...(f.type_config.end != null ? { end: f.type_config.end } : {}),
      } : undefined,
    })),
    checklists: (t.checklists ?? []).map((c: any) => ({ items: (c.items ?? []).map((i: any) => ({ resolved: !!i.resolved })) })),
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(() => 0) : undefined,
    text_content: t.text_content ?? null,
  };
}

/** The token owner, their workspace and every task assigned to them (open and closed, with subtasks). */
export async function getTaskSummary({ refresh = false } = {}): Promise<TaskSummary> {
  const token = await getClickUpToken();
  const key = tokenKey(token);
  if (!refresh) { const c = fresh(summaryCache.get(key), SUMMARY_TTL); if (c) return c; }

  const { user } = await call<{ user: any }>(token, "/user");
  const { teams = [] } = await call<{ teams?: any[] }>(token, "/team");
  const wanted = process.env.CLICKUP_TEAM_ID?.trim();
  const team = wanted ? teams.find((t) => String(t.id) === wanted) : teams[0];
  if (!team) throw new ClickUpError(wanted ? `No ClickUp workspace with id ${wanted} for this token. Check CLICKUP_TEAM_ID.` : "This ClickUp account has no workspaces.", 502);

  const tasks: CUTask[] = [];
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({ page: String(page), subtasks: "true", include_closed: "true" });
    q.append("assignees[]", String(user.id));
    const data = await call<{ tasks?: any[]; last_page?: boolean }>(token, `/team/${team.id}/task?${q}`);
    tasks.push(...(data.tasks ?? []).map(trim));
    if (data.last_page || !data.tasks || data.tasks.length < 100) break;
  }
  const value: TaskSummary = {
    user: { id: user.id },
    workspace: team.name ?? "",
    tasks,
    fetchedAt: Date.now(),
  };
  summaryCache.set(key, { at: Date.now(), value });
  return value;
}

/** A task's comments, newest first. */
export async function getTaskComments(taskId: string): Promise<TaskComment[]> {
  const token = await getClickUpToken();
  const key = `${tokenKey(token)}:${taskId}`;
  const c = fresh(commentCache.get(key), COMMENT_TTL);
  if (c) return c;
  const data = await call<{ comments?: any[] }>(token, `/task/${encodeURIComponent(taskId)}/comment`);
  const list = (data.comments ?? []).map((x) => ({
    text: String(x.comment_text ?? "").trim(),
    who: x.user?.username || x.user?.email || "Someone",
    date: Number(x.date) || 0,
  })).filter((x) => x.text).sort((a, b) => b.date - a.date);
  commentCache.set(key, { at: Date.now(), value: list });
  if (commentCache.size > 5000) commentCache.delete(commentCache.keys().next().value!); // keep memory bounded
  return list;
}
