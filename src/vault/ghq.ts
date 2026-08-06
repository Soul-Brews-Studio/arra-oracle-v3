import { execFileSync } from 'child_process';

const SAFE_REPO = /^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$/;

export function normalizeGhqRepo(repo: string): string {
  const normalized = String(repo ?? '').trim();
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((part) => part === '..' || part === '') ||
    !SAFE_REPO.test(normalized)
  ) {
    throw new Error('Vault repo must be a ghq-style owner/repo path');
  }
  return normalized;
}

export function ghqListPaths(repo?: string): string[] {
  const args = repo ? ['list', '-p', normalizeGhqRepo(repo)] : ['list', '-p'];
  const output = execFileSync('ghq', args, { encoding: 'utf-8' }).trim();
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

export function ghqGet(repo: string): void {
  execFileSync('ghq', ['get', normalizeGhqRepo(repo)], { encoding: 'utf-8', stdio: 'pipe' });
}
