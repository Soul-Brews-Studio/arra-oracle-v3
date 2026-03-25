/**
 * Frontmatter parsing: extract tags and project from markdown YAML frontmatter
 */

/**
 * Parse frontmatter tags from markdown content
 * Supports: tags: [a, b, c] or tags: a, b, c
 */
export function parseFrontmatterTags(content: string): string[] {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return [];

  const frontmatter = frontmatterMatch[1];

  // Match tags: [tag1, tag2] or tags: tag1, tag2
  const tagsMatch = frontmatter.match(/^tags:\s*\[?([^\]\n]+)\]?/m);
  if (!tagsMatch) return [];

  return tagsMatch[1]
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
}

/**
 * Parse frontmatter project from markdown content
 * Returns the project field if found in frontmatter
 * Also extracts project from source field (e.g., "source: rrr: owner/repo")
 */
export function parseFrontmatterProject(content: string): string | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const frontmatter = frontmatterMatch[1];

  // First, try direct project: field
  const projectMatch = frontmatter.match(/^project:\s*(.+)$/m);
  if (projectMatch) {
    const project = projectMatch[1].trim();
    // Handle quoted values
    if ((project.startsWith('"') && project.endsWith('"')) ||
        (project.startsWith("'") && project.endsWith("'"))) {
      return project.slice(1, -1);
    }
    return project || null;
  }

  // Fallback: extract from source field (e.g., "source: rrr: owner/repo")
  const sourceMatch = frontmatter.match(/^source:\s*rrr:\s*(.+)$/m);
  if (sourceMatch) {
    const repo = sourceMatch[1].trim();
    if (repo && repo.includes('/')) {
      return `github.com/${repo}`;
    }
  }

  // Fallback: known project patterns in source field
  const sourceField = frontmatter.match(/^source:\s*(.+)$/m);
  if (sourceField) {
    const source = sourceField[1].trim().toLowerCase();
    const sourceMapping = process.env.ORACLE_SOURCE_MAPPINGS;
    if (sourceMapping) {
      try {
        const mappings = JSON.parse(sourceMapping) as Record<string, string>;
        for (const [key, project] of Object.entries(mappings)) {
          if (source.includes(key.toLowerCase())) return project;
        }
      } catch { /* ignore invalid JSON */ }
    }
  }

  return null;
}
