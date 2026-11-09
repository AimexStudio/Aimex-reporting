"use client";

import { useActionState, useState } from "react";
import { bulkAddLoginAction, type BulkResult } from "../actions";
import { CATEGORIES, type ClientCategory } from "@/lib/category";

type C = { id: string; name: string; category: ClientCategory };

export function BulkAddLoginForm({ clients }: { clients: C[] }) {
  const [s, action, pending] = useActionState<BulkResult, FormData>(bulkAddLoginAction, {});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [roles, setRoles] = useState<Record<string, "client" | "client_admin">>({});
  const [k, setK] = useState(0);
  const count = Object.values(ticked).filter(Boolean).length;
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const setAll = (cat: ClientCategory, on: boolean) => setTicked((t) => ({ ...t, ...Object.fromEntries(clients.filter((c) => c.category === cat).map((c) => [c.id, on])) }));
  const roleAll = (r: "client" | "client_admin") => setRoles((x) => ({ ...x, ...Object.fromEntries(clients.filter((c) => ticked[c.id]).map((c) => [c.id, r])) }));

  return (
    <div className="grid gap-5">
      {s.error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-sm text-neg">{s.error}</p>}
      {s.ok && (
        <div role="status" className="grid gap-2 rounded-xl border border-accent/40 bg-accent-soft/60 p-4 text-sm">
          <p className="font-medium">{s.ok}</p>
          {!!s.added?.length && <p>Added: {s.added.map(nameOf).join(", ")}</p>}
          {!!s.already?.length && <p className="text-ink-2">Already had: {s.already.map(nameOf).join(", ")}</p>}
          {s.email && s.password && (
            <>
              <p className="mt-1 font-medium">New login. Send these details; the password won’t be shown again:</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-surface p-3 font-sans">{`Sign in at ${typeof window !== "undefined" ? window.location.origin : ""}\nEmail: ${s.email}\nPassword: ${s.password}`}</pre>
            </>
          )}
        </div>
      )}

      <form key={k} action={(fd) => { action(fd); setK((x) => x + 1); setTicked({}); setRoles({}); }} className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field"><span>Email</span><input className="input" type="email" name="email" required autoComplete="off" /></label>
          <label className="field"><span>Password (only used if the email is new)</span>
            <input className="input" name="password" minLength={10} placeholder="Leave blank to generate" autoComplete="new-password" /></label>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">{count ? `${count} client${count === 1 ? "" : "s"} ticked` : "Tick the clients below"}</span>
          {count > 0 && (
            <>
              <span className="text-ink-3">Set all ticked to</span>
              <button type="button" className="rounded-full bg-line-soft px-3 py-1 font-medium hover:bg-line" onClick={() => roleAll("client")}>Viewer</button>
              <button type="button" className="rounded-full bg-line-soft px-3 py-1 font-medium hover:bg-line" onClick={() => roleAll("client_admin")}>Admin</button>
            </>
          )}
        </div>

        {CATEGORIES.map((cat) => {
          const group = clients.filter((c) => c.category === cat.id);
          if (!group.length) return null;
          const allOn = group.every((c) => ticked[c.id]);
          return (
            <fieldset key={cat.id} className="grid gap-2">
              <legend className="mb-1 flex w-full items-center justify-between gap-3">
                <span className="font-semibold">{cat.label}</span>
                <button type="button" className="text-sm font-medium text-brand-strong hover:underline" onClick={() => setAll(cat.id, !allOn)}>
                  {allOn ? "Clear all" : "Select all"}
                </button>
              </legend>
              <ul className="divide-y divide-line-soft rounded-xl border border-line">
                {group.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <label className="flex min-w-0 cursor-pointer items-center gap-3">
                      <input type="checkbox" name="client" value={c.id} checked={!!ticked[c.id]} className="size-4 accent-[var(--color-night)]"
                        onChange={(e) => setTicked((t) => ({ ...t, [c.id]: e.target.checked }))} />
                      <span className="truncate font-medium">{c.name}</span>
                    </label>
                    <select name={`role:${c.id}`} aria-label={`Permission for ${c.name}`} className="input w-auto py-1 text-sm disabled:opacity-40"
                      disabled={!ticked[c.id]} value={roles[c.id] ?? "client"} onChange={(e) => setRoles((x) => ({ ...x, [c.id]: e.target.value as "client" | "client_admin" }))}>
                      <option value="client">Viewer</option>
                      <option value="client_admin">Admin</option>
                    </select>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}

        <div><button className="btn" disabled={pending || !count}>{pending ? "Adding…" : `Add to ${count || ""} client${count === 1 ? "" : "s"}`.replace("  ", " ")}</button></div>
      </form>
    </div>
  );
}
