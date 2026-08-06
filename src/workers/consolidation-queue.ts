import type { ConsolidationPlan } from './consolidation.ts';

export type QueuedConsolidationPlan = ConsolidationPlan & {
  queuedAt: number;
  source: 'sleep-time-vector' | 'sleep-time-llm';
  model: string;
  similarity: number;
};

const queue = new Map<string, QueuedConsolidationPlan>();

export function queueConsolidationSuggestions(
  plans: QueuedConsolidationPlan[],
): { emitted: number; total: number } {
  let emitted = 0;
  for (const plan of plans) {
    const key = queueKey(plan);
    if (!queue.has(key)) emitted += 1;
    queue.set(key, plan);
  }
  return { emitted, total: queue.size };
}

export function listQueuedConsolidationPlans(tenantId: string, limit = 250): QueuedConsolidationPlan[] {
  return [...queue.values()]
    .filter((plan) => plan.tenantId === tenantId)
    .sort((a, b) => b.queuedAt - a.queuedAt)
    .slice(0, limit);
}

export function queuedConsolidationCount(): number {
  return queue.size;
}

export function clearConsolidationQueueForTests(): void {
  queue.clear();
}

function queueKey(plan: ConsolidationPlan): string {
  return `${plan.tenantId}:${plan.oldId}->${plan.newId}`;
}
