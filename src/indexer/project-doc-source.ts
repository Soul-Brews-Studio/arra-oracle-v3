/**
 * Indexing helpers for canonical Oracle work-project context under `ψ/projects/`.
 *
 * Project files reuse OracleDocument type `learning` rather than widening the
 * closed document-type union. Their durable discriminator is `source_file`.
 *
 * Canonical project identity is derived only from:
 *   recursive Markdown files under ψ/projects/<project-id>/
 * where project-id matches lowercase-hyphenated Oracle project ids (<=64 chars).
 *
 * `ψ/projects/README.md` is indexed as universal project-contract documentation
 * with project=null. Invalid project directories fail closed and are not indexed.
 */
import path from 'path';
import type { OracleDocument } from '../types.ts';
import { parseLearningFile } from './parser.ts';

export const PSI_PROJECTS_REL = path.join('ψ', 'projects');
const PROJECT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROJECT_ID_MAX = 64;

function normalizeSource(sourceFile: string): string {
  return sourceFile.split(path.sep).join('/');
}

export function isPsiProjectsSource(sourceFile: string): boolean {
  const normalized = normalizeSource(sourceFile);
  return normalized === 'ψ/projects/README.md' || normalized.startsWith('ψ/projects/');
}

export function projectIdFromProjectsSource(sourceFile: string): string | null {
  const normalized = normalizeSource(sourceFile);
  if (normalized === 'ψ/projects/README.md') return null;
  if (!normalized.startsWith('ψ/projects/')) return null;

  const rest = normalized.slice('ψ/projects/'.length);
  const parts = rest.split('/');
  if (parts.length < 2) return null;

  const candidate = parts[0] ?? '';
  if (
    candidate.length === 0 ||
    candidate.length > PROJECT_ID_MAX ||
    !PROJECT_ID_RE.test(candidate)
  ) return null;

  return candidate;
}

function projectDocId(pathHash: string, id: string): string {
  const suffix = id
    .replace(/^learning_/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return `learning_psi_project_${pathHash}_${suffix || 'doc'}`;
}

export function parsePsiProjectFile(relativePath: string, content: string): OracleDocument[] {
  const sourceFile = normalizeSource(relativePath);
  if (!isPsiProjectsSource(sourceFile)) return [];

  const isRootReadme = sourceFile === 'ψ/projects/README.md';
  const project = projectIdFromProjectsSource(sourceFile);

  if (!isRootReadme && project === null) return [];

  const basename = path.basename(sourceFile);
  const pathHash = Bun.hash(sourceFile).toString(36);

  return parseLearningFile(basename, content, sourceFile).map((doc) => ({
    ...doc,
    id: projectDocId(pathHash, doc.id),
    type: 'learning',
    source_file: sourceFile,
    project,
  }));
}
