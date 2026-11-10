"use client";

import { useEffect, useState } from "react";

/** Today's date and the time, ticking every second, in the viewer's own time zone (as in myHR). */
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="h-6" aria-hidden="true" />;
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const short = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <time dateTime={now.toISOString()} className="flex flex-col items-center leading-tight text-ink sm:flex-row sm:gap-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-ink-3 sm:text-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden sm:block">
          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
        <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{date}</span>
      </span>
      <span className="font-bold tabular-nums sm:text-lg">{time}</span>
    </time>
  );
}
