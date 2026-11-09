/** Simple generic icons for marketing channels (not the platforms' own logos). */
export function ChannelIcon({ name, className = "size-4" }: { name: string; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const d: Record<string, React.ReactNode> = {
    pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" {...p} /><circle cx="12" cy="10" r="2.3" {...p} /></>,
    megaphone: <><path d="M4 10v4h3l7 4V6L7 10H4zM17.5 9.5a3.5 3.5 0 0 1 0 5" {...p} /></>,
    people: <><circle cx="9" cy="8" r="3" {...p} /><path d="M3.5 19c.7-3 3-4.5 5.5-4.5s4.8 1.5 5.5 4.5M16 6.5a2.5 2.5 0 1 1 0 5M17.5 14.5c1.7.5 2.8 2 3 4.5" {...p} /></>,
    camera: <><rect x="3.5" y="6.5" width="17" height="13" rx="3" {...p} /><circle cx="12" cy="13" r="3.5" {...p} /><path d="M8.5 6.5 10 4h4l1.5 2.5" {...p} /></>,
    search: <><circle cx="11" cy="11" r="6" {...p} /><path d="m20 20-4.5-4.5" {...p} /></>,
    bed: <><path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" {...p} /><circle cx="7" cy="12" r="1.5" {...p} /></>,
    moon: <><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" {...p} /></>,
  };
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true">{d[name] ?? d.megaphone}</svg>;
}
