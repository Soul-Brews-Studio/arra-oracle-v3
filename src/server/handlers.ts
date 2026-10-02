/** Core request handlers; stable exports for routes and tools. */
export { buildFtsQuery } from './handlers/search-helpers.ts';
export { handleSearch } from './handlers/search.ts';
export { handleReflect, handleList } from './handlers/browse.ts';
export { handleStats, handleGraph } from './handlers/stats.ts';
export { persistLearningDoc, handleLearn, handleSessionSummary } from './handlers/learn.ts';
export { cosineDistanceToSimilarity } from '../vector/scoring.ts';
