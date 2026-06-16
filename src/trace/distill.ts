import { eq } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import { handleLearn } from '../server/handlers.ts';
import { getTrace } from './handler.ts';
import type { DistillTraceInput } from './types.ts';

export type DistillTraceResult = {
  success: boolean;
  status: string;
  learningId?: string;
  error?: string;
};

function learningConcepts(traceId: string): string[] {
  return ['trace-awakening', 'thor-oracle', 'dev-research', `trace-${traceId}`];
}

export function distillTraceAwakening(input: DistillTraceInput): DistillTraceResult {
  const trace = getTrace(input.traceId);
  if (!trace) return { success: false, status: 'not_found', error: 'Trace not found' };

  const learning = input.promoteToLearning
    ? handleLearn(
      input.awakening,
      `Trace awakening ${input.traceId}`,
      learningConcepts(input.traceId),
      'thor-oracle',
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
  };
}
