/**
 * Bulk collector for canonical Oracle work-project context under `ψ/projects/`.
 *
 * Unlike fleet inbox copies, project documents are deliberately NOT deduplicated
 * by content hash. Project identity and source path are semantic: two projects
 * may legitimately carry identical wording and both must remain retrievable.
 */
import fs from 'fs';
import path from 'path';
import type { IndexerConfig, OracleDocument } from '../types.ts';
import { getAllMarkdownFiles } from './collectors.ts';
import {
  PSI_PROJECTS_REL,
  isPsiProjectsSource,
  parsePsiProjectFile,
} from './project-doc-source.ts';

function isWithin(realRoot: string, realFile: string): boolean {
  const rel = path.relative(realRoot, realFile);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

export function collectPsiProjects(opts: {
  config: IndexerConfig;
}): OracleDocument[] {
  const { config } = opts;
  const subPath = config.sourcePaths.projects ?? PSI_PROJECTS_REL;
  const sourceRoot = path.join(config.repoRoot, subPath);
  if (!fs.existsSync(sourceRoot)) return [];

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(sourceRoot);
  } catch {
    return [];
  }

  const documents: OracleDocument[] = [];
  const files = getAllMarkdownFiles(sourceRoot);
  let skippedOutsideRoot = 0;
  let skippedInvalid = 0;
  let skippedEmpty = 0;

  for (const filePath of files) {
    let realFile: string;
    try {
      realFile = fs.realpathSync(filePath);
    } catch {
      continue;
    }
    if (!isWithin(realRoot, realFile)) {
      skippedOutsideRoot++;
      continue;
    }

    const relPath = path.relative(config.repoRoot, filePath).split(path.sep).join('/');
    if (!isPsiProjectsSource(relPath)) {
      skippedInvalid++;
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    if (!content.trim()) {
      skippedEmpty++;
      continue;
    }

    const parsed = parsePsiProjectFile(relPath, content);
    if (parsed.length === 0) {
      skippedInvalid++;
      continue;
    }
    documents.push(...parsed);
  }

  console.log(
    `Indexed ${documents.length} ψ/projects documents from ${files.length} files ` +
    `(skipped ${skippedInvalid} invalid, ${skippedEmpty} empty, ${skippedOutsideRoot} outside-root)`
  );
  return documents;
}
