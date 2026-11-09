"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

const look = "items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white/85 ring-1 ring-white/25 hover:bg-white/10";
const btn = `inline-flex ${look}`;

/**
 * Prepares the report for paper, then opens the print dialog (where "Save as PDF" is available):
 * lays the report out at a fixed A4-friendly width so charts resize to fit, opens every
 * collapsed section, prints, then puts everything back.
 */
export function PrintButton({ onPrepare, onDone }: { onPrepare?: () => void; onDone?: () => void } = {}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Also prepare when someone uses the browser's own Print (Cmd/Ctrl+P): draw the whole report straight away.
    const before = () => {
      if (onPrepare) flushSync(onPrepare);
      openDetails(true);
    };
    const after = () => {
      openDetails(false);
      document.documentElement.classList.remove("printing");
      onDone?.();
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  async function print() {
    setBusy(true);
    onPrepare?.(); // draw every section of the report
    document.documentElement.classList.add("printing");
    await new Promise((r) => setTimeout(r, 300));
    window.dispatchEvent(new Event("resize")); // charts re-measure at print width
    await new Promise((r) => setTimeout(r, 900));
    openDetails(true);
    setBusy(false);
    window.print();
  }

  return (
    <button type="button" onClick={print} className={btn} disabled={busy} aria-label="Download the whole report as a PDF" title="Download the whole report as a PDF">
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
      </svg>
      {busy ? "Preparing…" : "Download"}
    </button>
  );
}

const opened = new Set<HTMLDetailsElement>();
function openDetails(open: boolean) {
  if (open) {
    document.querySelectorAll<HTMLDetailsElement>("details:not([open])").forEach((d) => {
      d.open = true;
      opened.add(d);
    });
  } else {
    opened.forEach((d) => (d.open = false));
    opened.clear();
  }
}

/** Toggles the browser's full-screen mode, for presenting the report. Hidden where unsupported (e.g. iPhone). */
export function FullscreenButton() {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    setSupported(!!document.fullscreenEnabled);
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  if (!supported) return null;
  return (
    <button type="button" className={`hidden sm:inline-flex ${look}`} aria-pressed={on}
      onClick={() => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {on ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
      </svg>
      {on ? "Exit full screen" : "Full screen"}
    </button>
  );
}
