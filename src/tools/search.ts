/** Search MCP tool public surface. Implementation lives in ./search/*. */

export { searchToolDef } from './search/definition.ts';
export {
  attachSearchEvidence,
  combineResults,
  confidenceForResult,
  normalizeFtsScore,
  parseConceptsFromMetadata,
  provenanceForResult,
  sanitizeFtsQuery,
} from './search/helpers.ts';
export { vectorSearch } from './search/vector.ts';
export {
  applyEntityLinkBoost,
  hasEntityLinkSearchHook,
  queryEntityLinks,
  type EntityLinkHit,
  type EntityLinkSearchHook,
} from './search/entities.ts';
export { handleSearch } from './search/handler.ts';
export type { CombinedSearchResult, FtsResult, SearchConfidence, SearchProvenance, VectorResult } from './search/types.ts';
