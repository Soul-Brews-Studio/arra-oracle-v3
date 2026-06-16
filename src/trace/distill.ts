import { eq } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import { handleLearn } from '../server/handlers.ts';
import { getTrace } from './handler.ts';
import { THOR_ORACLE_ID, THOR_ORACLE_THEME } from '../oracles/thor.ts';
import type { DistillTraceInput } from './types.ts';

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
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueConcepts(values: string[]): string[] {
  return [...new Set(values.map(conceptSlug).filter(Boolean))];
}

function oracleOrigin(input: DistillTraceInput): string {
  return conceptSlug(input.oracle ?? DEFAULT_ORACLE) || DEFAULT_ORACLE;
}

function learningConcepts(input: DistillTraceInput): string[] {
  return uniqueConcepts([
    'trace-awakening',
    oracleOrigin(input),
    'dev-research',
    input.theme ?? DEFAULT_THEME,
    `trace-${input.traceId}`,
    ...(input.concepts ?? []),
  ]);
}

export function distillTraceAwakening(input: DistillTraceInput): DistillTraceResult {
  const trace = getTrace(input.traceId);
  if (!trace) return { success: false, status: 'not_found', error: 'Trace not found' };

  const origin = oracleOrigin(input);
  const concepts = learningConcepts(input);
  const learning = input.promoteToLearning
    ? handleLearn(
      input.awakening,
      input.source?.trim() || `Trace awakening ${input.traceId}`,
      concepts,
      origin,
      trace.project ?? undefined,
    )
    : undefined;
  const now = Date.now();
  const update: Partial<typeof traceLog.$inferInsert> = {
    status: 'distilled',
    awakening: input.awakening,
    distilledAt: now,
    updatedAt: now,
  };
  if (learning?.id) update.distilledToId = learning.id;

  db.update(traceLog)
    .set(update)
    .where(eq(traceLog.traceId, input.traceId))
    .run();

  return {
    success: true,
    status: 'distilled',
    learningId: learning?.id,
    origin: learning?.id ? origin : undefined,
    concepts: learning?.id ? concepts : undefined,
  };
}
