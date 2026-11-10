export function money(value: number | null | undefined, currency = "USD", compact = false) {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-US")}`;
  }
}

export function hours(value: number | null | undefined) {
  if (value == null) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} h`;
}

/** Dates are stored as plain `YYYY-MM-DD`; format in UTC so they never shift a day. */
export function date(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function durationDays(start: string | null, end: string | null) {
  if (!start || !end) return null;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

/** A person's name for greetings: their full name, or one made from the email ("saurabh.p@x.com" -> "Saurabh P"). */
export function displayName(p: { full_name?: string | null; email: string }) {
  const full = p.full_name?.trim();
  if (full) return full;
  return p.email.split("@")[0].split(/[._-]+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ") || p.email;
}
