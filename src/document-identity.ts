import { createHash } from 'node:crypto';

export const UNIVERSAL_PROJECT = '__universal__';

const PROJECT_ALIASES: Record<string, string> = {
  'my second brain v2': 'github.com/mengazaa/my-second-brain-v2',
};

export function canonicalProject(project?: string | null): string {
  const value = project?.trim().toLowerCase();
  if (!value) return UNIVERSAL_PROJECT;

  const alias = PROJECT_ALIASES[value];
  if (alias) return alias;

  return value;
}

export function storedProject(project?: string | null): string | null {
  const canonical = canonicalProject(project);
  return canonical === UNIVERSAL_PROJECT ? null : canonical;
}

export function documentStorageId(project: string | null | undefined, displayId: string): string {
  if (!displayId) throw new Error('displayId is required');
  return `doc:${contentDigest(`${canonicalProject(project)}\0${displayId}`)}`;
}

export function contentDigest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
