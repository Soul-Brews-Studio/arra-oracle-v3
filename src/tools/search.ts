/** Search MCP tool public surface. Implementation lives in ./search/*. */

export { searchToolDef } from './search/definition.ts';
export {
  combineResults,
  normalizeFtsScore,
  parseConceptsFromMetadata,
  sanitizeFtsQuery,
} from './search/helpers.ts';
export { vectorSearch } from './search/vector.ts';
export { handleSearch } from './search/handler.ts';
export type { CombinedSearchResult, FtsResult, VectorResult } from './search/types.ts';
