/**
 * Vault path mapping — local ψ/ paths ↔ vault paths.
 *
 * Project-first layout: {project}/ψ/memory/learnings/file.md
 * Universal categories (resonance) stay flat at vault root.
 */

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
  return PROJECT_CATEGORIES.some((cat) => relativePath.startsWith(cat));
}

/**
 * Map a local ψ/ relative path to its vault destination.
 * Project-first layout: {project}/ψ/memory/learnings/file.md
 * Universal categories (resonance) stay flat at vault root.
 */
export function mapToVaultPath(relativePath: string, project: string | null): string {
  if (!project) return relativePath;

  // Universal categories stay flat (no project prefix)
  for (const category of UNIVERSAL_CATEGORIES) {
    if (relativePath.startsWith(category)) return relativePath;
  }

  // Everything else: prefix with project
  return `${project}/${relativePath}`;
}

/**
 * Reverse: map a vault path back to local ψ/ path.
 * Strips {project}/ prefix to get the local relative path.
 */
export function mapFromVaultPath(vaultRelativePath: string, project: string): string | null {
  // Check project prefix: {project}/ψ/... → ψ/...
  const prefix = `${project}/`;
  if (vaultRelativePath.startsWith(prefix)) {
    return vaultRelativePath.slice(prefix.length);
  }

  // Universal categories — keep as-is
  for (const category of UNIVERSAL_CATEGORIES) {
    if (vaultRelativePath.startsWith(category)) {
      return vaultRelativePath;
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
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    // Already has project: field
    if (/^project:\s/m.test(frontmatter)) return content;

    // Inject project: after existing frontmatter fields
    const newFrontmatter = `${frontmatter}\nproject: ${project}`;
    return content.replace(frontmatterMatch[0], `---\n${newFrontmatter}\n---`);
  }

  // No frontmatter — add one
  return `---\nproject: ${project}\n---\n\n${content}`;
}
