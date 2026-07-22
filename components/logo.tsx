// The goBuy brand lockup: the "Vaminho" mascot (a rider pushing an approved
// purchase through the cart) beside the wordmark. One canonical definition —
// used by the app header and the login hero.

/** The mascot mark on its own. Decorative — the wordmark carries the name. */
export function GoBuyMascot({ size, className = "" }: { size: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/gobuy-mascot.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The styled "goBuy" wordmark. Black weight + italic lean + tight tracking give
 * it motion (echoing the running mascot); "go" in ink, "Buy" in the Vammo blue.
 * Renders as an inline span so it can sit inside an <h1> or beside the mascot.
 */
export function GoBuyWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black italic leading-none tracking-[-0.045em] ${className}`}>
      <span className="text-[var(--ink)]">go</span>
      <span className="text-[var(--accent)]">Buy</span>
    </span>
  );
}

/** Horizontal lockup (mascot + wordmark) for the app header. */
export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const px = size === "lg" ? 76 : 32;
  const text = size === "lg" ? "text-5xl" : "text-xl";
  return (
    <span className="inline-flex items-center gap-2">
      <GoBuyMascot size={px} />
      <GoBuyWordmark className={text} />
    </span>
  );
}
