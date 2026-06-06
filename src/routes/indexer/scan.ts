import { Elysia, t } from 'elysia';
import fs from 'fs';
import path from 'path';
import { getAllMarkdownFiles } from '../../indexer/collectors.ts';
import { normalizeIndexerRepoRoot, resolveIndexerRepoRoot } from '../../indexer/runner.ts';

export const scanEndpoint = new Elysia().post('/indexer/scan', async ({ body }) => {
  const { sourcePath, types } = body ?? {};
  const repoRoot = sourcePath ? normalizeIndexerRepoRoot(sourcePath) : resolveIndexerRepoRoot();
  const psiPath = path.join(repoRoot, '\u03c8');
  const scanPath = fs.existsSync(psiPath) ? psiPath : repoRoot;

  if (!fs.existsSync(scanPath)) {
    return { error: `Path not found: ${scanPath}`, files: [], total: 0, byType: {}, repoRoot, psiDetected: false };
  }

  const allFiles = getAllMarkdownFiles(scanPath);

  const files = allFiles.map(filePath => {
    const stat = fs.statSync(filePath);
    const rel = path.relative(scanPath, filePath);

    let type = 'unknown';
    if (rel.includes('distillations') || rel.includes('distillation')) type = 'distillation';
    else if (rel.includes('learnings') || rel.includes('learning')) type = 'learning';
    else if (rel.includes('retrospectives') || rel.includes('retro')) type = 'retro';
    else if (rel.includes('resonance') || rel.includes('principle')) type = 'principle';

    return {
      path: filePath,
      relativePath: rel,
      size: stat.size,
      type,
      modified: stat.mtimeMs,
    };
  });

  const filtered = types && types.length > 0
    ? files.filter(f => types.includes(f.type))
    : files;

  const byType: Record<string, number> = {};
  for (const f of filtered) {
    byType[f.type] = (byType[f.type] || 0) + 1;
  }

  return {
    files: filtered,
    total: filtered.length,
    byType,
    repoRoot,
    psiPath: fs.existsSync(psiPath) ? psiPath : null,
    psiDetected: fs.existsSync(psiPath),
    canIndexFts: fs.existsSync(psiPath) && filtered.length > 0,
    recommendedAction: fs.existsSync(psiPath) && filtered.length > 0 ? 'POST /api/indexer/reindex' : null,
  };
}, {
  body: t.Optional(t.Object({
    sourcePath: t.Optional(t.String()),
    types: t.Optional(t.Array(t.String())),
  })),
  detail: {
    tags: ['indexer'],
    summary: 'Scan directory for .md files',
  },
});
