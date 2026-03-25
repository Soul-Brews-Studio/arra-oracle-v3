/**
 * Git status parsing for vault operations.
 */

export interface GitStatusCounts {
  added: number;
  modified: number;
  deleted: number;
}

export function parseGitStatus(porcelainOutput: string): GitStatusCounts {
  let added = 0;
  let modified = 0;
  let deleted = 0;

  if (!porcelainOutput.trim()) return { added, modified, deleted };

  for (const line of porcelainOutput.trim().split('\n')) {
    const code = line.substring(0, 2);
    if (code.includes('A') || code === '??') added++;
    else if (code.includes('D')) deleted++;
    else if (code.includes('M') || code.includes('R')) modified++;
  }

  return { added, modified, deleted };
}
