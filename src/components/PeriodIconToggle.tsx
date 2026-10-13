"use client";

import type { PeriodKind } from "@/lib/period";

/** Monthly / weekly switch shown as two calendar icons. Names appear on hover and for screen readers. */
export function PeriodIconToggle({ value, onChange, tone = "light", label = "Period" }: {
  value: PeriodKind;
  onChange: (v: PeriodKind) => void;
  tone?: "light" | "dark";
  label?: string;
}) {
  // Light: an outlined control the same height as the fields beside it. Dark: for the report sidebar.
  const wrap = tone === "dark" ? "bg-white/[0.06] ring-1 ring-white/10 p-1" : "h-[2.625rem] border border-line bg-surface p-[3px]";
  const on = tone === "dark" ? "bg-brand text-white" : "bg-night text-white";
  const off = tone === "dark" ? "text-white/60 hover:text-white" : "text-ink-3 hover:bg-line-soft hover:text-ink";
  const btn = tone === "dark" ? "size-9 rounded-lg" : "h-full w-11 rounded-md";
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex w-fit justify-self-start gap-0.5 rounded-lg ${wrap}`}>
      {(["month", "week"] as const).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} aria-label={k === "month" ? "Monthly" : "Weekly"}
          title={k === "month" ? "Monthly" : "Weekly"} onClick={() => onChange(k)}
          className={`grid place-items-center ${btn} ${value === k ? on : off}`}>
          <CalendarIcon kind={k} />
        </button>
      ))}
    </div>
  );
}

function CalendarIcon({ kind }: { kind: PeriodKind }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" {...p} />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" {...p} />
      {kind === "month" ? (
        // a full month: a grid of days
        <path d="M7.5 13h.01M10.5 13h.01M13.5 13h.01M16.5 13h.01M7.5 16.5h.01M10.5 16.5h.01M13.5 16.5h.01M16.5 16.5h.01" {...p} strokeWidth={2.4} />
      ) : (
        // one week: a single highlighted row
        <rect x="6.5" y="12.2" width="11" height="3.6" rx="1" fill="currentColor" stroke="none" />
      )}
    </svg>
  );
}
