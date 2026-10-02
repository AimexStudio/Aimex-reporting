import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Wordmark } from "@/components/Wordmark";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/dashboard");

  return (
    <main className="grid min-h-dvh md:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-night p-12 text-white md:flex">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-40 size-[520px] rounded-full bg-brand/15 blur-3xl" />
        <Wordmark className="h-11 self-start" />
        <div className="max-w-md">
          <MiniChart />
          <p className="brand-h mt-8 text-3xl leading-tight">
            Your marketing <strong className="text-brand">results</strong>
          </p>
          <p className="mt-4 text-white/70">
            Sign in to see how your campaigns performed and what changed since last month.
          </p>
        </div>
        <p className="text-sm text-white/50">Powered by Aimex Studio</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Wordmark tone="dark" className="mb-10 h-10 self-start md:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mb-8 mt-1 text-ink-2">Use the email and password Aimex Studio gave you.</p>
          <LoginForm />
          <p className="mt-8 text-sm text-ink-3">Forgotten your password? Ask your Aimex account manager to reset it.</p>
        </div>
      </section>
    </main>
  );
}

function MiniChart() {
  const h = [22, 30, 26, 38, 35, 46, 44, 58, 54, 66, 72, 84];
  return (
    <svg viewBox="0 0 240 90" className="w-64" aria-hidden="true">
      {h.map((v, i) => (
        <rect key={i} x={i * 20} y={90 - v} width="12" height={v} rx="2"
          fill={i === h.length - 1 ? "var(--color-brand)" : "rgba(255,255,255,.18)"} />
      ))}
    </svg>
  );
}
