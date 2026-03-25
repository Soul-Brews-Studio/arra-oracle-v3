/**
 * Concept extraction and tag merging
 */

/**
 * Extract concept tags from text
 * Combines keyword matching with optional file-level tags
 */
export function extractConcepts(...texts: string[]): string[] {
  const combined = texts.join(' ').toLowerCase();
  const concepts = new Set<string>();

  // Common Oracle concepts (expanded list)
  const keywords = [
    'trust', 'pattern', 'mirror', 'append', 'history', 'context',
    'delete', 'behavior', 'intention', 'decision', 'human', 'external',
    'brain', 'command', 'oracle', 'timestamp', 'immutable', 'preserve',
    // Additional keywords for better coverage
    'learn', 'memory', 'session', 'workflow', 'api', 'mcp', 'claude',
    'git', 'code', 'file', 'config', 'test', 'debug', 'error', 'fix',
    'feature', 'refactor', 'style', 'docs', 'plan', 'task', 'issue'
  ];

  for (const keyword of keywords) {
    if (combined.includes(keyword)) {
      concepts.add(keyword);
    }
  }

  return Array.from(concepts);
}

/**
 * Merge extracted concepts with file-level tags
 */
export function mergeConceptsWithTags(extracted: string[], fileTags: string[]): string[] {
  return [...new Set([...extracted, ...fileTags])];
}
