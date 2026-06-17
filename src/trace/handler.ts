/** Trace Log Handler facade. Implementation is split by concern. */
export { createTrace, getTrace } from './store.ts';
export { listTraces } from './list.ts';
export { getTraceChain, getTraceLinkedChain } from './chain.ts';
export { linkTraces, unlinkTraces } from './links.ts';
export { distillTrace } from './status.ts';
