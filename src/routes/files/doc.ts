import { Elysia, t } from 'elysia';
import { sqlite, db, oracleDocuments } from '../../db/index.ts';
import { and, eq } from 'drizzle-orm';
import { docParams } from './model.ts';
import { currentTenantId, tenantIdForWrite } from '../../middleware/tenant.ts';

// Body schemas for PATCH/POST.
const PatchDocBody = t.Object({
  content: t.Optional(t.String()),
  concepts: t.Optional(t.Array(t.String())),
  title: t.Optional(t.String()),
});

const PostDocBody = t.Object({
  id: t.Optional(t.String()),
  type: t.String(),
  content: t.String(),
  concepts: t.Optional(t.Array(t.String())),
  source_file: t.Optional(t.String()),
  project: t.Optional(t.String()),
});

function tenantFilter(alias = 'd'): { clause: string; params: string[] } {
  const tenantId = currentTenantId();
  return tenantId ? { clause: `AND ${alias}.tenant_id = ?`, params: [tenantId] } : { clause: '', params: [] };
}

function docWhere(id: string) {
  const tenantId = currentTenantId();
  return tenantId
    ? and(eq(oracleDocuments.id, id), eq(oracleDocuments.tenantId, tenantId))
    : eq(oracleDocuments.id, id);
}

export const docRoute = new Elysia()
  .get(
    '/api/doc/:id',
    ({ params, set }) => {
      try {
        const filter = tenantFilter('d');
        const row = sqlite
          .prepare(
            `
        SELECT d.id, d.type, d.source_file, d.concepts, d.project, f.content
        FROM oracle_documents d
        JOIN oracle_fts f ON d.id = f.id
        WHERE d.id = ? ${filter.clause}
      `,
          )
          .get(params.id, ...filter.params) as any;

        if (!row) {
          set.status = 404;
          return { error: 'Document not found' };
        }

        return {
          id: row.id,
          type: row.type,
          content: row.content,
          source_file: row.source_file,
          concepts: JSON.parse(row.concepts || '[]'),
          project: row.project,
        };
      } catch (e: any) {
        set.status = 500;
        return { error: e.message };
      }
    },
    {
      params: docParams,
      detail: {
        tags: ['files'],
        menu: { group: 'hidden' },
        summary: 'Get one oracle document by id',
      },
    },
  )
  .patch(
    '/api/doc/:id',
    ({ params, body, set }) => {
      try {
        const filter = tenantFilter('d');
        const existing = sqlite
          .prepare(`SELECT id FROM oracle_documents d WHERE d.id = ? ${filter.clause}`)
          .get(params.id, ...filter.params) as { id: string } | undefined;
        if (!existing) {
          set.status = 404;
          return { error: 'Document not found' };
        }

        const data = (body ?? {}) as Record<string, any>;
        const now = Date.now();

        const patch: Record<string, any> = { updatedAt: now, indexedAt: now };
        if (Array.isArray(data.concepts)) {
          const dedup = Array.from(
            new Set(data.concepts.filter((c: any) => typeof c === 'string' && c).map((c: string) => c.toLowerCase())),
          );
          patch.concepts = JSON.stringify(dedup);
        }

        db.update(oracleDocuments).set(patch).where(docWhere(params.id)).run();

        if (typeof data.content === 'string') {
          const conceptsRow = sqlite
            .prepare(`SELECT concepts FROM oracle_documents d WHERE d.id = ? ${filter.clause}`)
            .get(params.id, ...filter.params) as { concepts: string };
          const conceptsArr: string[] = conceptsRow ? JSON.parse(conceptsRow.concepts || '[]') : [];
          sqlite.prepare(`DELETE FROM oracle_fts WHERE id = ?`).run(params.id);
          sqlite
            .prepare(`INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)`)
            .run(params.id, data.content, conceptsArr.join(' '));
        }

        return { ok: true, id: params.id };
      } catch (e: any) {
        set.status = 500;
        return { error: e.message };
      }
    },
    {
      params: docParams,
      body: PatchDocBody,
      detail: {
        tags: ['files'],
        menu: { group: 'hidden' },
        summary: 'Update a doc (content/concepts) — for Obsidian round-trip',
      },
    },
  )
  .post(
    '/api/doc',
    ({ body, set }) => {
      try {
        const data = (body ?? {}) as Record<string, any>;
        const now = Date.now();
        const id = typeof data.id === 'string' && data.id
          ? data.id
          : `${data.type}_${now}_${Math.random().toString(36).slice(2, 8)}`;

        const filter = tenantFilter('d');
        const existing = sqlite
          .prepare(`SELECT id FROM oracle_documents d WHERE d.id = ? ${filter.clause}`)
          .get(id, ...filter.params);
        if (existing) {
          set.status = 409;
          return { error: `Document already exists: ${id}` };
        }

        const conceptsArr: string[] = Array.isArray(data.concepts)
          ? Array.from(new Set(data.concepts.filter((c: any) => typeof c === 'string' && c).map((c: string) => c.toLowerCase())))
          : [];

        db.insert(oracleDocuments).values({
          id,
          tenantId: tenantIdForWrite(),
          type: data.type,
          sourceFile: data.source_file ?? `imported/${id}.md`,
          concepts: JSON.stringify(conceptsArr),
          createdAt: now,
          updatedAt: now,
          indexedAt: now,
          project: typeof data.project === 'string' ? data.project.toLowerCase() : null,
          createdBy: 'import-obsidian',
        }).run();

        sqlite.prepare(`DELETE FROM oracle_fts WHERE id = ?`).run(id);
        sqlite
          .prepare(`INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)`)
          .run(id, data.content, conceptsArr.join(' '));

        return { ok: true, id };
      } catch (e: any) {
        if (String(e?.message ?? '').includes('UNIQUE constraint failed: oracle_documents.id')) {
          set.status = 409;
          return { error: 'Document id unavailable' };
        }
        set.status = 500;
        return { error: e.message };
      }
    },
    {
      body: PostDocBody,
      detail: {
        tags: ['files'],
        menu: { group: 'hidden' },
        summary: 'Create a new doc — for Obsidian round-trip --create-new',
      },
    },
  );
