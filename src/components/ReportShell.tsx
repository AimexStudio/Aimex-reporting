import { Wordmark } from "./Wordmark";
import { signOut } from "@/app/actions";

export function ReportShell({ clientName, children, banner, tabs }: { clientName: string; children: React.ReactNode; banner?: React.ReactNode; tabs?: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-page">
      {banner}
      <header className="bg-night text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <Wordmark />
            <span className="hidden h-5 w-px bg-white/20 sm:block" aria-hidden="true" />
            <span className="hidden truncate text-sm text-white/70 sm:block">Performance report for {clientName}</span>
          </div>
          {!banner && (
            <form action={signOut}>
              <button className="rounded-lg px-3 py-1.5 text-sm font-medium text-white/85 ring-1 ring-white/25 hover:bg-white/10">Sign out</button>
            </form>
          )}
        </div>
      </header>
      {tabs}
      {children}
      <footer className="mx-auto max-w-6xl px-5 pb-12 pt-4 text-sm text-ink-3 sm:px-8">
        Prepared by Aimex Studio. Results are updated monthly. Questions about a number? Contact your account manager.
      </footer>
    </div>
  );
}
