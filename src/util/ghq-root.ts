/**
 * Resolve the ghq root the same way ghq itself does, without requiring the
 * ghq binary on PATH. MCP processes are spawned with a minimal PATH that
 * lacks /opt/homebrew/bin, so `ghq root` alone is not reliable — but git
 * lives in /usr/bin and carries the same answer via `git config ghq.root`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

function spawnTrimmed(cmd: string[]): string | null {
  try {
    const out = Bun.spawnSync(cmd, { env: { ...process.env } }).stdout.toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

export function detectGhqRoot(repoRoot: string): string {
  const envRoot = process.env.GHQ_ROOT?.trim();
  if (envRoot) return envRoot;

  const fromGhq = spawnTrimmed(['ghq', 'root']);
  if (fromGhq) return fromGhq;

  const home = process.env.HOME || os.homedir();

  const fromGit = spawnTrimmed(['git', 'config', '--get', 'ghq.root']);
  if (fromGit) return path.resolve(fromGit.replace(/^~(?=\/|$)/, home));

  const ghqDefault = path.join(home, 'ghq');
  if (fs.existsSync(ghqDefault)) return ghqDefault;

  const match = repoRoot.match(/^(.+?)\/github\.com\//);
  return match ? match[1] : path.dirname(path.dirname(path.dirname(repoRoot)));
}
