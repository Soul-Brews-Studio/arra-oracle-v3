import { eq } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import type { DistillTraceInput } from './types.ts';
import { getTrace } from './store.ts';

export function distillTrace(
  input: DistillTraceInput,
): { success: boolean; status: string; learningId?: string } {
  if (!getTrace(input.traceId)) return { success: false, status: 'not_found' };
  const now = Date.now();
  db.update(traceLog)
    .set({ status: 'distilled', awakening: input.awakening, distilledAt: now, updatedAt: now })
    .where(eq(traceLog.traceId, input.traceId))
    .run();
  return { success: true, status: 'distilled' };
}
