import { bumpDocumentUsage } from '../../server/logging.ts';

type ReinforceFn = (ids: string[]) => void | Promise<void>;
type ReinforceableResult = { id: string };

export function scheduleMemoryReinforcement(
  results: ReinforceableResult[],
  reinforce: ReinforceFn = bumpReturnedDocuments,
): void {
  const ids = uniqueIds(results);
  if (!ids.length) return;
  setTimeout(() => {
    try {
      void Promise.resolve(reinforce(ids)).catch(logReinforcementFailure);
    } catch (error) {
      logReinforcementFailure(error);
    }
  });
}

function bumpReturnedDocuments(ids: string[]): void {
  for (const id of ids) bumpDocumentUsage(id);
}

function uniqueIds(results: ReinforceableResult[]): string[] {
  return [...new Set(results.map((result) => result.id).filter(Boolean))];
}

function logReinforcementFailure(error: unknown): void {
  console.error('Failed to reinforce memory retrieval:', error);
}
