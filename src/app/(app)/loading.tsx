/** Shown the moment a link is clicked, while the server loads the next page. The sidebar stays in place. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="mb-6 space-y-2">
        <div className="h-3 w-20 rounded bg-surface-2" />
        <div className="h-7 w-56 rounded bg-surface-2" />
        <div className="h-4 w-80 max-w-full rounded bg-surface-2" />
      </div>
      <div className="card space-y-4">
        <div className="h-4 w-2/3 rounded bg-surface-2" />
        <div className="h-4 w-1/2 rounded bg-surface-2" />
        <div className="h-4 w-3/4 rounded bg-surface-2" />
      </div>
    </div>
  );
}
