import { HEALTH_STATE_COPY, HealthState } from './simple/healthState';

const toneDots: Record<(typeof HEALTH_STATE_COPY)[HealthState]['tone'], string> = {
  good: 'bg-emerald-400',
  wait: 'bg-blue-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-500',
};

export function checkedAgo(checkedAt: number | null, now = Date.now()): string {
  if (!checkedAt) return 'not checked yet';
  const seconds = Math.max(0, Math.floor((now - checkedAt) / 1000));
  return `checked ${seconds}s ago`;
}

export function HealthHero({
  state,
  checkedAt,
  onAction,
}: {
  state: HealthState;
  checkedAt: number | null;
  onAction: () => void;
}) {
  const copy = HEALTH_STATE_COPY[state];
  return (
    <section
      aria-live="polite"
      className="rounded-3xl border border-border bg-surface p-8 shadow-2xl"
      data-health-state={state}
      role="status"
    >
      <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.25em] text-text-muted">
        <span
          aria-hidden="true"
          className={`h-3 w-3 rounded-full ${toneDots[copy.tone]}`}
          data-testid="simple-health-dot"
        />
        Simple mode
      </div>
      <h1 className="mt-4 text-4xl font-bold text-text">{copy.title}</h1>
      <p className="mt-3 max-w-2xl text-base text-text-muted">{copy.detail}</p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          className="focus-ring rounded-full bg-accent-solid px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-solid"
          type="button"
          onClick={onAction}
        >
          {copy.action}
        </button>
        <span className="text-sm text-text-muted">{checkedAgo(checkedAt)}</span>
      </div>
    </section>
  );
}
