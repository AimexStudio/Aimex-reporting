import { notFound } from "next/navigation";
import { getDashboardData, getDashboards, getOverviewData } from "@/lib/data";
import { signOut } from "@/app/actions";
import { ReportApp } from "./ReportApp";

/**
 * One client's report: the combined overview (when they have several dashboards)
 * or a single dashboard. `clientId` must come from the session for client users.
 * `view` is "overview", a dashboard id, or undefined for the default.
 */
export async function ReportPage({ clientId, view, href, banner, manageHref, showSignOut = true }: {
  clientId: string;
  view?: string;
  href: (view: string) => string;
  banner?: React.ReactNode;
  manageHref?: string | null;
  showSignOut?: boolean;
}) {
  const dashboards = await getDashboards(clientId);
  if (!dashboards.length) notFound();
  const multi = dashboards.length > 1;
  const current = view && (view === "overview" || dashboards.some((d) => d.id === view)) ? view : multi ? "overview" : dashboards[0].id;
  const data = current === "overview" ? await getOverviewData(clientId) : await getDashboardData(clientId, current);
  if (!data) notFound();

  const companies = multi
    ? [{ id: "overview", name: "All companies", href: href("overview") }, ...dashboards.map((d) => ({ id: d.id, name: d.name, href: href(d.id) }))]
    : [];
  return (
    <>
      {banner && <div className="print:hidden">{banner}</div>}
      <ReportApp key={current} data={data} companies={companies} currentCompany={current} manageHref={manageHref}
        signOut={showSignOut ? (
          <form action={signOut}>
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 ring-1 ring-white/20 hover:bg-white/10 lg:ring-0">Sign out</button>
          </form>
        ) : null} />
    </>
  );
}
