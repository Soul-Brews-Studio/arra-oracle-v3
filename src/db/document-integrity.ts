import { eq } from 'drizzle-orm';
import type { DatabaseConnection } from './create.ts';
import { oracleDocuments } from './schema.ts';

type Db = DatabaseConnection['db'];
type DocumentWhere = (id: string) => any;

export function documentIdExists(db: Db, id: string): boolean {
  return Boolean(db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, id))
    .get());
}

export function supersedeWouldCreateCycle(
  db: Db,
  oldId: string,
  newId: string,
  docWhere: DocumentWhere,
): boolean {
  const seen = new Set<string>([oldId]);
  let cursor: string | null = newId;
  for (let depth = 0; cursor && depth < 100; depth += 1) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row = db.select({ supersededBy: oracleDocuments.supersededBy })
      .from(oracleDocuments)
      .where(docWhere(cursor))
      .get();
    cursor = row?.supersededBy ?? null;
  }
  return false;
}
