import { CONSENT_LABEL, SOURCE_LABEL, type ConsentStatus, type LeadSource, type LeadStatus } from "@/lib/stratos/types";

const pill = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset";

/** Conversion probability as a bar plus the number; colour bands at 30 and 60. */
export function ScoreBar({ value }: { value: number }) {
  const tone = value >= 60 ? "bg-ok" : value >= 30 ? "bg-warn" : "bg-bad";
  return (
    <span className="inline-flex items-center gap-2" title={`Conversion probability ${value}%`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line">
        <span className={`block h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="font-mono text-xs text-ink-2">{Math.round(value)}%</span>
    </span>
  );
}

const STATUS_STYLE: Record<LeadStatus, string> = {
  active: "bg-info-soft text-info ring-info/25",
  won: "bg-ok-soft text-ok ring-ok/25",
  lost: "bg-surface-2 text-ink-3 ring-line-strong",
  unsubscribed: "bg-warn-soft text-warn ring-warn/25",
  archived: "bg-surface-2 text-ink-3 ring-line-strong",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`${pill} ${STATUS_STYLE[status]}`}>{status[0].toUpperCase() + status.slice(1)}</span>;
}

const CONSENT_STYLE: Record<ConsentStatus, string> = {
  unknown: "bg-surface-2 text-ink-3 ring-line-strong",
  granted: "bg-ok-soft text-ok ring-ok/25",
  withdrawn: "bg-warn-soft text-warn ring-warn/25",
  erasure_requested: "bg-bad-soft text-bad ring-bad/25",
};

export function ConsentBadge({ status }: { status: ConsentStatus }) {
  return <span className={`${pill} ${CONSENT_STYLE[status]}`}>{CONSENT_LABEL[status]}</span>;
}

export function SourceLabel({ source }: { source: LeadSource }) {
  return <span className="text-xs text-ink-3">{SOURCE_LABEL[source]}</span>;
}
