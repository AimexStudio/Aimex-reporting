/** Small line icons for figures. Decorative: always aria-hidden. */
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const paths: Record<string, React.ReactNode> = {
  spend: <><rect x="3" y="6" width="18" height="13" rx="2" {...P} /><path d="M3 10h18M16 15h2" {...P} /></>,
  leads: <><circle cx="10" cy="8" r="3.5" {...P} /><path d="M3.5 19c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5M18 8v5M15.5 10.5h5" {...P} /></>,
  conversions: <><path d="M4 12.5l5 5L20 6.5" {...P} /></>,
  revenue: <><path d="M4 17l5-5 4 3 7-8M15 7h5v5" {...P} /></>,
  cost: <><path d="M3.5 12.5l8-8h8v8l-8 8z" {...P} /><circle cx="15.5" cy="8.5" r="1.4" {...P} /></>,
  impressions: <><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" {...P} /><circle cx="12" cy="12" r="2.8" {...P} /></>,
  clicks: <><path d="M9 4v3M4.5 6l2 2M3 11h3M12 10l8 3-3.5 1.5L15 18z" {...P} /></>,
  sessions: <><rect x="3" y="4.5" width="18" height="14" rx="2" {...P} /><path d="M3 8.5h18" {...P} /></>,
  roas: <><path d="M12 3v18M16.5 6.5c-.9-1.2-2.6-2-4.5-2-2.5 0-4.5 1.3-4.5 3.2 0 4.3 9.5 2.2 9.5 6.6 0 1.9-2 3.2-4.7 3.2-2 0-3.8-.8-4.8-2.1" {...P} /></>,
  default: <><circle cx="12" cy="12" r="8" {...P} /></>,
};
const alias: Record<string, string> = { cpl: "cost", cpa: "cost", cpc: "cost", cpm: "cost", ctr: "clicks", conv_rate: "conversions", users: "sessions", reach: "impressions", calls: "leads", conversations: "leads", followers: "leads" };

export function MetricIcon({ metric, className = "size-5" }: { metric: string; className?: string }) {
  const k = paths[metric] ? metric : alias[metric] ?? "default";
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true">{paths[k]}</svg>;
}
