/**
 * Vault path mapping — local ψ/ paths ↔ vault paths.
 *
 * Project-first layout: {project}/ψ/memory/learnings/file.md
 * Universal categories (resonance) stay flat at vault root.
 */

import path from 'node:path';

// Categories that get project-nested in the vault
export const PROJECT_CATEGORIES = [
  'ψ/memory/learnings/',
  'ψ/memory/retrospectives/',
  'ψ/inbox/handoff/',
];

// Universal categories — no project prefix
export const UNIVERSAL_CATEGORIES = [
  'ψ/memory/resonance/',
  'ψ/inbox/schedule.md',
  'ψ/inbox/focus-agent-main.md',
  'ψ/active/',
];

export function isProjectCategory(relativePath: string): boolean {
  const safePath = normalizeVaultRelativePath(relativePath);
  return PROJECT_CATEGORIES.some((cat) => safePath.startsWith(cat));
}

export function normalizeVaultRelativePath(value: string, label = 'vault path'): string {
  const raw = String(value ?? '').replaceAll('\\', '/').trim();
  if (!raw || raw.includes('\0') || raw.startsWith('/')) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (raw.split('/').some((part) => part === '..')) {
    throw new Error(`${label} must not contain parent directory segments`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`${label} must stay within the vault root`);
  }
  return normalized;
}

/**
 * Map a local ψ/ relative path to its vault destination.
 * Project-first layout: {project}/ψ/memory/learnings/file.md
 * Universal categories (resonance) stay flat at vault root.
 */
export function mapToVaultPath(relativePath: string, project: string | null): string {
  const safePath = normalizeVaultRelativePath(relativePath);
  if (!project) return safePath;
  const safeProject = normalizeVaultRelativePath(project, 'project');

  // Universal categories stay flat (no project prefix)
  for (const category of UNIVERSAL_CATEGORIES) {
    if (safePath.startsWith(category)) return safePath;
  }

  // Everything else: prefix with project
  return `${safeProject}/${safePath}`;
}

/**
 * Reverse: map a vault path back to local ψ/ path.
 * Strips {project}/ prefix to get the local relative path.
 */
export function mapFromVaultPath(vaultRelativePath: string, project: string): string | null {
  const safeVaultPath = normalizeVaultRelativePath(vaultRelativePath);
  const safeProject = normalizeVaultRelativePath(project, 'project');
  // Check project prefix: {project}/ψ/... → ψ/...
  const prefix = `${safeProject}/`;
  if (safeVaultPath.startsWith(prefix)) {
    return safeVaultPath.slice(prefix.length);
  }

  // Universal categories — keep as-is
  for (const category of UNIVERSAL_CATEGORIES) {
    if (safeVaultPath.startsWith(category)) {
      return safeVaultPath;
    }
  }

  return null; // Not a recognized path for this project
}

/**
 * Ensure markdown file has project: field in frontmatter.
 * If frontmatter exists but has no project:, inject it.
 * If no frontmatter, add one with just project:.
 * Returns modified content (or original if already has project).
 */
export function ensureFrontmatterProject(content: string, project: string): string {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const projectValue = yamlScalar(oneLine(project));

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    // Already has project: field
    if (/^project:\s/m.test(frontmatter)) return content;

    // Inject project: after existing frontmatter fields
    const newline = frontmatterMatch[0].includes('\r\n') ? '\r\n' : '\n';
    const newFrontmatter = `${frontmatter}${newline}project: ${projectValue}`;
    return content.replace(frontmatterMatch[0], `---${newline}${newFrontmatter}${newline}---`);
  }

  // No frontmatter — add one
  return `---\nproject: ${projectValue}\n---\n\n${content}`;
}

function oneLine(value: string): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map((part) => part.trim()).filter(Boolean).join(' ');
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._/@+-]*(?: [A-Za-z0-9._/@+-]+)*$/.test(value) ? value : JSON.stringify(value);
}
