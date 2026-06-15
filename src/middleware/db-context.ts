import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'drizzle-orm/logger';
import { requestIdFor } from './correlation.ts';

export type DbRequestContext = {
  requestId: string;
};

export type DbQueryTrace = DbRequestContext & {
  query: string;
  params: unknown[];
};

export type DbQueryTraceObserver = (trace: DbQueryTrace) => void;

type FetchHandler = (request: Request) => Response | Promise<Response>;

const dbRequestContext = new AsyncLocalStorage<DbRequestContext>();
let dbQueryTraceObserver: DbQueryTraceObserver | undefined;

export function currentDbRequestContext(): DbRequestContext | undefined {
  return dbRequestContext.getStore();
}

export function currentDbRequestId(): string | undefined {
  return currentDbRequestContext()?.requestId;
}

export function runWithDbRequestContext<T>(requestId: string, callback: () => T): T {
  return dbRequestContext.run({ requestId }, callback);
}

export function createDbContextFetch(next: FetchHandler): FetchHandler {
  return (request) => runWithDbRequestContext(requestIdFor(request), () => next(request));
}

export function setDbQueryTraceObserverForTests(observer?: DbQueryTraceObserver): () => void {
  const previous = dbQueryTraceObserver;
  dbQueryTraceObserver = observer;
  return () => {
    dbQueryTraceObserver = previous;
  };
}

function emitDbQueryTrace(query: string, params: unknown[]): void {
  const requestId = currentDbRequestId();
  if (!requestId) return;
  dbQueryTraceObserver?.({ requestId, query, params });
}

export function createDbContextQueryLogger(observer = emitDbQueryTrace): Logger {
  return {
    logQuery(query, params) {
      observer(query, params);
    },
  };
}
