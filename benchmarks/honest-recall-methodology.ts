type RecallLabel = `Recall@${number}`;
type MetricKey = 'Answerable-Recall@k' | 'Reject-Recall' | 'Reject-Precision';
type MetricFamily = 'Recall@k' | 'Reject';

export type RetrievalCase = {
  expected_ids: string[];
  hit: boolean;
  retrieved_ids: string[];
};

export type RetrievalMetricRow = {
  metric: MetricKey;
  metric_family: MetricFamily;
  label: string;
  value: number;
  hits: number;
  total_queries: number;
  top_k: number;
  correct_rejections?: number;
  total_unanswerable?: number;
  total_rejections?: number;
  predicted_rejects?: number;
  runs?: number;
  variance?: number;
  stdev?: number;
};

export type MetricSamples = Partial<Record<MetricKey, number[]>>;

export function buildRetrievalMetrics(cases: RetrievalCase[], topK: number, recallLabel: RecallLabel, samples: MetricSamples = {}): RetrievalMetricRow[] {
  const answerable = cases.filter((item) => item.expected_ids.length > 0);
  const negative = cases.filter((item) => item.expected_ids.length === 0);
  const predictedRejects = cases.filter((item) => item.retrieved_ids.length === 0);
  const answerHits = answerable.filter((item) => item.hit).length;
  const rejectHits = negative.filter((item) => item.hit).length;

  return [
    row('Answerable-Recall@k', 'Recall@k', `Answerable-${recallLabel}`, answerHits, answerable.length, topK, samples),
    row('Reject-Recall', 'Reject', 'Reject-Recall', rejectHits, negative.length, topK, samples, {
      correct_rejections: rejectHits, total_unanswerable: negative.length,
    }),
    row('Reject-Precision', 'Reject', 'Reject-Precision', rejectHits, predictedRejects.length, topK, samples, {
      correct_rejections: rejectHits, total_rejections: predictedRejects.length, predicted_rejects: predictedRejects.length,
    }),
  ];
}

function row(
  metric: MetricKey,
  metric_family: MetricFamily,
  label: string,
  hits: number,
  total: number,
  top_k: number,
  samples: MetricSamples,
  extra: Partial<RetrievalMetricRow> = {},
): RetrievalMetricRow {
  const base = { metric, metric_family, label, value: total > 0 ? round(hits / total) : 0, hits, total_queries: total, top_k, ...extra };
  const stats = statsFor(samples[metric]);
  return stats ? { ...base, value: stats.mean, runs: stats.runs, variance: stats.variance, stdev: stats.stdev } : base;
}

function statsFor(values?: number[]) {
  if (!values?.length) return null;
  const runs = values.length;
  const mean = values.reduce((sum, item) => sum + item, 0) / runs;
  const variance = values.reduce((sum, item) => sum + ((item - mean) ** 2), 0) / runs;
  return { runs, mean: round(mean), variance: round(variance), stdev: round(Math.sqrt(variance)) };
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
