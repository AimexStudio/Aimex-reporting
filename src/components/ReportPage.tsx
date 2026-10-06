import Link from "next/link";
import { notFound } from "next/navigation";
import { getDashboardData, getDashboards, getOverviewData } from "@/lib/data";
import { Dashboard } from "./Dashboard";
import { ReportShell } from "./ReportShell";

/**
 * One client's report: the combined overview (when they have several dashboards)
 * or a single dashboard. `clientId` must come from the session for client users.
 * `view` is "overview", a dashboard id, or undefined for the default.
 */
export async function ReportPage({ clientId, view, href, banner }: {
  clientId: string;
  view?: string;
  href: (view: string) => string;
  banner?: React.ReactNode;
}) {
  const dashboards = await getDashboards(clientId);
  if (!dashboards.length) notFound();
  const multi = dashboards.length > 1;
  const current = view && (view === "overview" || dashboards.some((d) => d.id === view)) ? view : multi ? "overview" : dashboards[0].id;
  const data = current === "overview" ? await getOverviewData(clientId) : await getDashboardData(clientId, current);
  if (!data) notFound();

  const tabs = multi ? [{ id: "overview", name: "Overview" }, ...dashboards.map((d) => ({ id: d.id, name: d.name }))] : [];
  return (
    <ReportShell
      clientName={data.client.name}
      banner={banner}
      tabs={tabs.length ? (
        <nav aria-label="Dashboards" className="bg-night">
          <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 pb-0 sm:px-8">
            {tabs.map((t) => (
              <Link key={t.id} href={href(t.id)} aria-current={t.id === current ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-medium ${t.id === current ? "bg-white/10 text-white shadow-[inset_0_-2px_0_var(--color-brand)]" : "text-white/60 hover:text-white"}`}>
                {t.name}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    >
      <Dashboard key={current} data={data} />
    </ReportShell>
  );
}
