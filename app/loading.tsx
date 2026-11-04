// Shown while a server page streams (alerts, cases and repos read from GitHub and the store).
export default function Loading() {
  return (
    <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-10 grid grid-cols-[minmax(0,1fr)] gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-48 rounded-[4px] bg-sunken animate-pulse" />
      <div className="h-4 w-80 max-w-full rounded-[4px] bg-sunken animate-pulse" />
      <div className="grid gap-2 mt-4">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-[8px] border hair bg-raised animate-pulse" />)}</div>
    </div>
  );
}
