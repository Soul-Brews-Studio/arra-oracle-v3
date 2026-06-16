import { eq } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import { handleLearn } from '../server/handlers.ts';
import { getOracleProfile } from '../oracles/registry.ts';
import { THOR_ORACLE_ID, THOR_ORACLE_THEME } from '../oracles/thor.ts';
import { getTrace } from './handler.ts';
import type { DistillTraceInput } from './types.ts';
import type { StormforgeEvidence, StormforgeFinding } from '../oracles/model.ts';

const DEFAULT_ORACLE = THOR_ORACLE_ID;
const DEFAULT_THEME = THOR_ORACLE_THEME;

export type DistillTraceResult = {
  success: boolean;
  status: string;
  learningId?: string;
  origin?: string;
  concepts?: string[];
  error?: string;
};

function conceptSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function uniqueConcepts(values: string[]): string[] {
  return [...new Set(values.map(conceptSlug).filter(Boolean))];
}

function oracleOrigin(input: DistillTraceInput): string {
  const profile = getOracleProfile(input.oracle ?? DEFAULT_ORACLE);
  const fallback = conceptSlug(input.oracle ?? DEFAULT_ORACLE);
  return (profile?.id ?? fallback) || DEFAULT_ORACLE;
}

function defaultConcepts(input: DistillTraceInput): string[] {
  const profile = getOracleProfile(input.oracle ?? DEFAULT_ORACLE) ?? getOracleProfile(oracleOrigin(input));
  return profile?.defaultConcepts ?? [DEFAULT_ORACLE, DEFAULT_THEME, 'dev-research'];
}

function learningConcepts(input: DistillTraceInput): string[] {
  const issueConcept = input.finding?.issue ? [`issue-${input.finding.issue}`] : [];
  return uniqueConcepts([
    'trace-awakening',
    oracleOrigin(input),
    input.theme ?? DEFAULT_THEME,
    `trace-${input.traceId}`,
    ...defaultConcepts(input),
    ...issueConcept,
    ...(input.concepts ?? []),
  ]);
}

function evidenceLines(items: StormforgeEvidence[] | undefined, kind: 'repo' | 'external'): string[] {
  return (items ?? []).map((item) => {
    const label = kind === 'repo' ? item.path : item.title ?? item.url;
    const suffix = item.url && kind === 'external' ? ` (${item.url})` : '';
    return `- ${label ?? 'evidence'}${suffix}: ${item.summary}`;
  });
}

function listSection(title: string, values: string[] | undefined): string[] {
  return values?.length ? [`### ${title}`, '', ...values.map((value) => `- ${value}`), ''] : [];
}

function findingSections(finding: StormforgeFinding): string[] {
  return [
    '## Stormforge finding',
    '',
    ...(finding.title ? [`### Title`, '', finding.title, ''] : []),
    ...(finding.question ? [`### Question`, '', finding.question, ''] : []),
    ...(finding.issue ? [`- Issue: #${finding.issue}`] : []),
    ...(finding.repo ? [`- Repo: ${finding.repo}`] : []),
    ...(finding.issue || finding.repo ? [''] : []),
    ...listSection('Repo evidence', evidenceLines(finding.repoEvidence, 'repo')),
    ...listSection('External sources', evidenceLines(finding.externalSources, 'external')),
    ...listSection('Hypotheses', finding.hypotheses),
    ...(finding.recommendation ? ['### Recommendation', '', finding.recommendation, ''] : []),
    ...listSection('Implementation plan', finding.implementationPlan),
    ...listSection('Verification plan', finding.verificationPlan),
    ...listSection('Open questions', finding.openQuestions),
  ];
}

export function renderDistilledAwakening(input: DistillTraceInput): string {
  const parts = [input.awakening.trim()];
  if (input.finding) parts.push(findingSections(input.finding).join('\n').trim());
  if (input.metadata && Object.keys(input.metadata).length) {
    parts.push(['## Metadata', '', '```json', JSON.stringify(input.metadata, null, 2), '```'].join('\n'));
  }
  return parts.filter(Boolean).join('\n\n');
}

export function distillTraceAwakening(input: DistillTraceInput): DistillTraceResult {
  const trace = getTrace(input.traceId);
  if (!trace) return { success: false, status: 'not_found', error: 'Trace not found' };

  const origin = oracleOrigin(input);
  const concepts = learningConcepts(input);
  const awakening = renderDistilledAwakening(input);
  const learning = input.promoteToLearning
    ? handleLearn(awakening, input.source?.trim() || `Trace awakening ${input.traceId}`, concepts, origin, trace.project ?? undefined)
    : undefined;
  const now = Date.now();
  const update: Partial<typeof traceLog.$inferInsert> = {
    status: 'distilled', awakening, distilledAt: now, updatedAt: now,
  };
  if (learning?.id) update.distilledToId = learning.id;

  db.update(traceLog).set(update).where(eq(traceLog.traceId, input.traceId)).run();

  return {
    success: true,
    status: 'distilled',
    learningId: learning?.id,
    origin: learning?.id ? origin : undefined,
    concepts: learning?.id ? concepts : undefined,
  };
}
