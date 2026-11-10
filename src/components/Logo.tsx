/** StratOS mark: the Zime hexagon (as in myHR and DealGuard) with a rising pipeline in place of the person. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <path d="M50.96,7.22 Q60,2 69.04,7.22 L101.19,25.78 Q110.23,31 110.23,41.44 L110.23,78.56 Q110.23,89 101.19,94.22 L69.04,112.78 Q60,118 50.96,112.78 L18.81,94.22 Q9.77,89 9.77,78.56 L9.77,41.44 Q9.77,31 18.81,25.78 Z" fill="#7A2EDB" />
      <rect x="34" y="66" width="12" height="20" rx="3" fill="#fff" />
      <rect x="54" y="52" width="12" height="34" rx="3" fill="#fff" />
      <rect x="74" y="36" width="12" height="50" rx="3" fill="#fff" />
    </svg>
  );
}

/** White-label: the wordmark comes from NEXT_PUBLIC_PRODUCT_NAME (default StratOS). */
export function Logo({ onDark = false, compact = false }: { onDark?: boolean; compact?: boolean }) {
  const name = process.env.NEXT_PUBLIC_PRODUCT_NAME || "StratOS";
  const split = name === "StratOS";
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-8 w-8 flex-none" />
      {!compact && (
        <span className={`font-heading text-[19px] font-extrabold tracking-tight ${onDark ? "text-white" : "text-ink"}`}>
          {split ? <>Strat<span className="text-brand">OS</span></> : name}
        </span>
      )}
    </span>
  );
}
