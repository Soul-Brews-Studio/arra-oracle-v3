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

  for (const keyword of scoredKeywords(combined)) concepts.add(keyword);

  return Array.from(concepts);
}

export function deriveConceptsFromPath(sourceFile: string): string[] {
  const local = localStructurePath(sourceFile);
  const tokens = local.split(/[\/._-]+/g)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !STRUCTURE_STOPWORDS.has(token));
  return [...new Set(tokens)].slice(0, 12);
}

/**
 * Merge extracted concepts with file-level tags
 */
export function mergeConceptsWithTags(extracted: string[], fileTags: string[]): string[] {
  return [...new Set([...extracted, ...fileTags])];
}

const STRUCTURE_STOPWORDS = new Set([
  'github', 'gitlab', 'bitbucket', 'com', 'org', 'repo', 'learn', 'memory',
  'learnings', 'retrospectives', 'distillations', 'inbox', 'handoff', 'the',
  'and', 'for', 'with', 'from', 'into', 'this', 'that', 'should', 'would',
]);

function scoredKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.split(/[^a-z0-9]+/g)) {
    const token = normalizeToken(raw);
    if (token.length < 4 || STRUCTURE_STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function localStructurePath(sourceFile: string): string {
  const normalized = sourceFile.replace(/\\/g, '/');
  const projectFirst = normalized.match(/^(?:github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+\/(ψ\/.*)$/);
  if (projectFirst) return projectFirst[1];
  const localProject = normalized.match(/^ψ\/learn\/[^/]+\/[^/]+\/(.*)$/);
  if (localProject) return localProject[1];
  return normalized;
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[0-9]+|[0-9]+$/g, '').trim();
}
