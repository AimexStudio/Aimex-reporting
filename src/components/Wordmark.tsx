/** The Aimex Studio logo, always in brand orange (public/brand/logo-color.png). */
export function Wordmark({ className = "" }: { className?: string; tone?: "light" | "dark" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/logo-color.png" alt="Aimex Studio" width={113} height={40}
      className={`h-8 w-auto shrink-0 object-contain ${className}`} />
  );
}
