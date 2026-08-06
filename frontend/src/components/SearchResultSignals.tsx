import { Badge, type BadgeTone } from './Badge';
import { MeterBar, type MeterTone } from './MeterBar';
import {
  confidenceLabel,
  confidenceScore,
  confidenceTone,
  heatDescription,
  heatScore,
  percentLabel,
  provenanceDescription,
  sourceDetails,
  sourceLabel,
  supersedeDateLabel,
  supersedeInfo,
  type ProvenanceSearchResult,
} from './searchResultView';
import { vectorResultsPath } from '../routePaths';

const meterTone: Record<BadgeTone, MeterTone> = {
  neutral: 'accent',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

export function SearchResultSignals({ result }: { result: ProvenanceSearchResult }) {
  const confidence = confidenceScore(result);
  const heat = heatScore(result);
  const tone = confidenceTone(result);
  const confidenceText = percentLabel(confidence) ?? '0%';
  const heatText = percentLabel(heat) ?? '0%';
  const provenance = provenanceDescription(result);
  const details = sourceDetails(result);
  const superseded = supersedeInfo(result);

  return (
    <section aria-label="Memory provenance and confidence" className="mt-4 grid gap-3 rounded-xl border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone} dot ariaLabel={`Confidence ${confidenceLabel(result)} ${confidenceText}`}>
          confidence {confidenceText} · {confidenceLabel(result)}
        </Badge>
        <Badge tone={heat > 0.66 ? 'success' : heat > 0.33 ? 'warning' : 'accent'} ariaLabel={`Heat ${heatText}`}>
          heat {heatText}
        </Badge>
        {superseded ? (
          <a
            className="focus-ring inline-flex max-w-full items-center rounded-full border border-warn-border bg-warn-bg/90 px-2.5 py-1 text-xs font-medium text-warn-text backdrop-blur-sm"
            href={vectorResultsPath(superseded.by)}
            title={superseded.reason ?? `Superseded by ${superseded.by}`}
          >
            <span className="truncate">superseded on {supersedeDateLabel(superseded.at)} → doc {superseded.by}</span>
          </a>
        ) : null}
      </div>

      <dl className="grid gap-2 text-xs text-text-muted sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-text-muted">source</dt>
          <dd className="mt-1 break-all font-mono text-text">{sourceLabel(result)}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.14em] text-text-muted">provenance</dt>
          <dd className="mt-1 text-text">{provenance || 'score-only result'}</dd>
        </div>
        {details.length ? <div className="sm:col-span-2"><dt className="sr-only">result details</dt><dd>{details.join(' · ')}</dd></div> : null}
        {superseded?.reason ? <div className="sm:col-span-2"><dt className="sr-only">supersede reason</dt><dd>{superseded.reason}</dd></div> : null}
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <MeterBar label="Confidence" percent={confidence * 100} tone={meterTone[tone]} valueText={confidenceText} description={provenance || 'Estimated from the returned match score.'} />
        <MeterBar label="Heat" percent={heat * 100} tone={heat > 0.66 ? 'success' : heat > 0.33 ? 'warning' : 'accent2'} valueText={heatText} description={heatDescription(result)} />
      </div>
    </section>
  );
}
