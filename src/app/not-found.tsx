import Link from "next/link";
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-1 text-ink-2">The link may be out of date.</p>
        <Link href="/" className="btn mt-5">Go to your dashboard</Link>
      </div>
    </main>
  );
}
