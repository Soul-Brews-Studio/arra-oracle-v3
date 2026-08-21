/**
 * The one canonicalizer for entity identity, shared by the SQL entity-link
 * side (search/entity-ranking.ts) and the parallel vector entity-sidecar
 * side (vector/entities.ts). Extracted to its own module so both can import
 * it without a cycle (entity-ranking imports extractEntities from
 * vector/entities). Unicode-safe: NFKC + `\p{L}\p{N}` keeps Thai/CJK/etc.
 * entities distinct instead of collapsing them to nothing (ORA-EBF-20260822-01).
 */
export function entityKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}
