"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { parseMetricsCsv, type ParseResult } from "@/lib/csv";
import { formatNumber, metricDef, monthLabel } from "@/lib/metrics";
import { importCsvFiles, type ImportResult } from "../actions";

const CHANNEL_SUGGESTIONS = ["Meta Ads", "Google Ads", "TikTok Ads", "LinkedIn Ads", "Website", "Email", "Instagram", "Facebook"];

function previousMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface Pending {
  id: string;
  name: string;
  text: string;
  channel: string;
  channelTouched: boolean;
  conversionsAs: "conversions" | "leads";
  preview: ParseResult;
}

/** Reads UTF-8, or the UTF-16 that Google Ads' "CSV (Excel)" export uses. */
async function readText(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  // UTF-16 without a byte-order mark: every other byte is zero
  if (buf.length > 4 && buf[1] === 0 && buf[3] === 0) return new TextDecoder("utf-16le").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
}

/** existing: "YYYY-MM|Channel" pairs already saved for this client. */
export function UploadPanel({ clientId, dashboardId, clientName, existing }: { clientId: string; dashboardId: string; clientName: string; existing: string[] }) {
  const [month, setMonth] = useState(previousMonth());
  const [files, setFiles] = useState<Pending[]>([]);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const parse = (text: string, m: string, ch: string, conv: "conversions" | "leads" = "conversions") =>
    parseMetricsCsv(text, m, ch, { conversionsAs: conv });

  async function addFiles(list: FileList | null) {
    setResult(null);
    if (!list?.length) return;
    const added: Pending[] = [];
    for (const f of Array.from(list)) {
      const text = await readText(f);
      const detected = parse(text, month, "").detectedSource ?? "";
      added.push({ id: crypto.randomUUID(), name: f.name, text, channel: detected, channelTouched: false, conversionsAs: "leads", preview: parse(text, month, detected, "leads") });
    }
    setFiles((cur) => [...cur, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function changeMonth(m: string) {
    setMonth(m);
    setFiles((cur) => cur.map((f) => ({ ...f, preview: parse(f.text, m, f.channel, f.conversionsAs) })));
  }

  function changeChannel(id: string, ch: string) {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, channel: ch, channelTouched: true, preview: parse(f.text, month, ch, f.conversionsAs) } : f)));
  }

  function changeConversions(id: string, conv: "conversions" | "leads") {
    setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, conversionsAs: conv, preview: parse(f.text, month, f.channel, conv) } : f)));
  }

  function reset() {
    setFiles([]);
    setNote("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function submit() {
    start(async () => {
      const r = await importCsvFiles({
        clientId,
        dashboardId,
        note,
        files: files.map((f) => ({ csv: f.text, filename: f.name, defaultMonth: month, defaultChannel: f.channel, conversionsAs: f.conversionsAs })),
      });
      setResult(r);
      if (r.ok) reset();
    });
  }

  // Checks across all chosen files.
  const pairs = new Map<string, string[]>();
  for (const f of files) for (const k of new Set(f.preview.rows.map((r) => `${r.month}|${r.channel}`))) pairs.set(k, [...(pairs.get(k) ?? []), f.name]);
  const clashes = [...pairs].filter(([, names]) => names.length > 1).map(([k, names]) => {
    const [m, c] = k.split("|");
    return `${names.join(" and ")} both contain ${c} for ${monthLabel(m)}. Change the channel on one of them, or remove one.`;
  });
  const overwrites = [...pairs.keys()].filter((k) => existing.includes(k)).map((k) => {
    const [m, c] = k.split("|");
    return `${c} for ${monthLabel(m)}`;
  });
  const months = [...new Set(files.flatMap((f) => f.preview.months))].sort();
  const hasErrors = files.some((f) => f.preview.errors.length > 0) || clashes.length > 0;
  const canImport = files.length > 0 && !hasErrors && files.every((f) => f.preview.rows.length > 0);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-[170px_1fr]">
        <label className="field"><span>Month</span>
          <input className="input" type="month" value={month} required onChange={(e) => changeMonth(e.target.value)} /></label>
        <label className="field"><span>CSV files</span>
          <input ref={inputRef} multiple className="input file:mr-3 file:rounded-md file:border-0 file:bg-night file:px-3 file:py-1 file:text-white"
            type="file" accept=".csv,text/csv" onChange={(e) => addFiles(e.target.files)} /></label>
      </div>
      <p className="-mt-2 text-sm text-ink-3">
        Choose one or more files, for example a Meta export and a Google Ads export for the same month. You can add more
        files before importing. Month and channel columns inside a file take priority over these fields.{" "}
        <a href="/admin/template" className="text-brand-strong underline">Download the template</a>.
      </p>

      {result?.ok && (
        <div role="status" className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-accent">
          {result.ok}
          {result.warnings?.length ? <ul className="mt-1 list-disc pl-5 text-ink-2">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        </div>
      )}
      {result?.error && (
        <div role="alert" className="rounded-lg bg-neg-soft px-4 py-3 text-sm text-neg">
          {result.error}
          {result.errors && <ul className="mt-1 list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}

      {files.length > 0 && (
        <div className="grid gap-4 rounded-xl border border-line bg-page/60 p-4">
          <div>
            <p className="font-medium">Check before importing</p>
            <p className="text-sm text-ink-2">
              {files.length} file{files.length === 1 ? "" : "s"}, covering {months.map((m) => monthLabel(m)).join(", ") || "no month yet"}.
            </p>
          </div>

          {files.map((f) => (
            <FileCard key={f.id} f={f} onChannel={(ch) => changeChannel(f.id, ch)} onConversions={(c) => changeConversions(f.id, c)}
              onRemove={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} />
          ))}
          <datalist id="channel-suggestions">{CHANNEL_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>

          {clashes.length > 0 && (
            <ul role="alert" className="list-disc rounded-lg bg-neg-soft px-4 py-3 pl-8 text-sm text-neg">{clashes.map((c) => <li key={c}>{c}</li>)}</ul>
          )}
          {overwrites.length > 0 && (
            <p className="rounded-lg border border-brand/40 bg-brand-soft px-3 py-2 text-sm">
              {clientName} already has {overwrites.join(", ")}. Importing replaces {overwrites.length === 1 ? "it" : "them"}. Other channels and months are left as they are.
            </p>
          )}

          {months.length === 1 && (
            <label className="field"><span>Note to the client for {monthLabel(months[0])} (optional)</span>
              <textarea className="input min-h-20" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="What happened this month and what’s next. Shown at the top of their report." /></label>
          )}

          <div className="flex flex-wrap gap-3">
            <button className="btn" disabled={!canImport || pending} onClick={submit}>
              {pending ? "Importing…" : files.length > 1 ? `Import ${files.length} files to ${clientName}’s dashboard` : `Import to ${clientName}’s dashboard`}
            </button>
            <button className="btn btn-quiet" onClick={reset} disabled={pending}>Clear all</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileCard({ f, onChannel, onConversions, onRemove }: {
  f: Pending; onChannel: (ch: string) => void; onConversions: (c: "conversions" | "leads") => void; onRemove: () => void;
}) {
  const p = f.preview;
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{f.name}</p>
          <p className="text-sm text-ink-2">
            {p.errors.length ? "Can’t be imported yet" : `${p.channels.join(", ") || "Nothing"} for ${p.months.map((m) => monthLabel(m)).join(", ") || "no month"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {p.hasConversions && (
            <label className="field w-48"><span>Count conversions as</span>
              <select className="input py-1.5" value={f.conversionsAs} onChange={(e) => onConversions(e.target.value as "conversions" | "leads")}>
                <option value="conversions">Conversions</option>
                <option value="leads">Leads</option>
              </select>
            </label>
          )}
          {p.hasChannelColumn ? (
            <p className="max-w-48 pb-1 text-sm text-ink-3">Channels are taken from the file’s channel column.</p>
          ) : (
            <label className="field w-44"><span>Channel</span>
              <input className="input py-1.5" list="channel-suggestions" value={f.channel} placeholder="e.g. Meta Ads" autoComplete="off" onChange={(e) => onChannel(e.target.value)} /></label>
          )}
          <button className="btn btn-quiet py-1.5" onClick={onRemove} aria-label={`Remove ${f.name}`}>Remove</button>
        </div>
      </div>
      {p.errors.length > 0 && <ul role="alert" className="mt-3 list-disc rounded-lg bg-neg-soft px-4 py-3 pl-8 text-sm text-neg">{p.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {p.info.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-ink-3">{p.info.map((w) => <li key={w}>{w}</li>)}</ul>}
      {p.warnings.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {p.rows.length > 0 && (
        <>
          <button className="mt-3 text-sm font-medium text-brand-strong hover:underline" onClick={() => setOpen(!open)}>
            {open ? "Hide figures" : "Show figures"}
          </button>
          {open && <PreviewTable p={p} />}
        </>
      )}
    </div>
  );
}

function PreviewTable({ p }: { p: ParseResult }) {
  const keyed = new Map(p.rows.map((r) => [`${r.month}|${r.channel}|${r.metric}`, r.value]));
  const lines = p.months.flatMap((m) => p.channels.filter((c) => p.metrics.some((k) => keyed.has(`${m}|${c}|${k}`))).map((c) => ({ m, c })));
  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-left text-ink-2">
            {p.months.length > 1 && <th className="px-3 py-2 font-medium">Month</th>}
            <th className="px-3 py-2 font-medium">Channel</th>
            {p.metrics.map((k) => <th key={k} className="px-3 py-2 text-right font-medium">{metricDef(k).label}</th>)}
          </tr>
        </thead>
        <tbody>
          {lines.map(({ m, c }) => {
            const branches = p.breakdowns[`${m}|${c}`]?.branches ?? [];
            return (
              <Fragment key={`${m}|${c}`}>
                <tr className="border-b border-line-soft last:border-0">
                  {p.months.length > 1 && <td className="px-3 py-2">{monthLabel(m, "short")}</td>}
                  <td className="px-3 py-2 font-medium">{c}{branches.length ? <span className="ml-1.5 text-xs font-normal text-ink-3">({branches.length} branches, total)</span> : null}</td>
                  {p.metrics.map((k) => {
                    const v = keyed.get(`${m}|${c}|${k}`);
                    return <td key={k} className="whitespace-nowrap px-3 py-2 text-right font-medium">{v == null ? "" : formatNumber(v, "ZAR", 2)}</td>;
                  })}
                </tr>
                {branches.map((b) => (
                  <tr key={`${m}|${c}|${b.label}`} className="border-b border-line-soft text-ink-2 last:border-0">
                    {p.months.length > 1 && <td />}
                    <td className="py-1.5 pl-8 pr-3">↳ {b.label}</td>
                    {p.metrics.map((k) => <td key={k} className="whitespace-nowrap px-3 py-1.5 text-right">{b.metrics[k] == null ? "" : formatNumber(b.metrics[k], "ZAR", 2)}</td>)}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
