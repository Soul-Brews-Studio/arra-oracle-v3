import path from 'node:path';
import { detectProject } from '../server/project-detect.ts';
import { deriveConceptsFromPath, extractConcepts } from './concepts.ts';
import { inferProjectFromPath } from './discovery.ts';

/**
 * Auto-derived bulk ingest structure spec.
 *
 * Goal: folder ingest should not require a manual taxonomy/collection wizard.
 * - project: prefer explicit/frontmatter project, then project-first vault path,
 *   then ghq-style repo context if present, then the ingested directory name.
 * - concepts: stable union of existing/frontmatter concepts, project tokens,
 *   folder/path tokens, and keyword-scored title/content tokens.
 * - safety: deterministic, local-only, no LLM/provider call, bounded concept count.
 */
export interface AutoDeriveInput {
  rootDir?: string;
  sourceFile: string;
  structurePath?: string;
  title?: string;
  content?: string;
  project?: string | null;
  existingConcepts?: string[];
  maxConcepts?: number;
}

export interface AutoDerivedStructure {
  project: string | null;
  concepts: string[];
  pathConcepts: string[];
  keywordConcepts: string[];
}

const DEFAULT_MAX_CONCEPTS = 20;
const PROJECT_TOKEN_STOPWORDS = new Set(['github', 'gitlab', 'bitbucket', 'com', 'org']);

export function autoDeriveStructure(input: AutoDeriveInput): AutoDerivedStructure {
  const project = deriveProject(input);
  const pathConcepts = deriveConceptsFromPath(input.structurePath ?? input.sourceFile);
  const keywordConcepts = extractConcepts(input.title ?? '', input.content ?? '');
  const concepts = uniqueConcepts([
    ...(input.existingConcepts ?? []),
    ...projectConcepts(project),
    ...pathConcepts,
    ...keywordConcepts,
  ]).slice(0, input.maxConcepts ?? DEFAULT_MAX_CONCEPTS);
  return { project, concepts, pathConcepts, keywordConcepts };
}

export function deriveProject(input: Pick<AutoDeriveInput, 'project' | 'sourceFile' | 'rootDir'>): string | null {
  const explicit = normalizeProject(input.project);
  if (explicit) return explicit;
  const fromSource = inferProjectFromPath(normalizeSlashes(input.sourceFile));
  if (fromSource) return fromSource;
  const fromRoot = input.rootDir ? projectFromRoot(input.rootDir) : null;
  if (fromRoot) return fromRoot;
  return projectFromSource(input.sourceFile);
}

export function projectFromRoot(rootDir: string): string | null {
  return detectProject(rootDir) ?? normalizeProject(path.basename(path.resolve(rootDir)));
}

function projectFromSource(sourceFile: string): string | null {
  const normalized = normalizeSlashes(sourceFile);
  const parts = normalized.split('/').filter(Boolean);
  if (parts[0] === 'mine' && parts[1]) return normalizeProject(parts[1]);
  if (parts.length > 1) return normalizeProject(parts[parts.length - 2]);
  return null;
}

function projectConcepts(project: string | null): string[] {
  if (!project) return [];
  const parts = project.split(/[\/._\s-]+/g)
    .map((token) => token.toLowerCase().replace(/^[0-9]+|[0-9]+$/g, '').trim())
    .filter((token) => token.length >= 3 && !PROJECT_TOKEN_STOPWORDS.has(token));
  return [project, ...parts];
}

function uniqueConcepts(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const token = value.toLowerCase().trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function normalizeProject(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\\/g, '/').replace(/\s+/g, '-');
  return normalized || null;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}
