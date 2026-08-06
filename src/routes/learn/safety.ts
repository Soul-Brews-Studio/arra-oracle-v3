import path from 'path';
import { REPO_ROOT } from '../../config.ts';

const repoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;

export const INVALID_LEARNING_ID = 'Invalid learning id';
export const INVALID_LEARNING_SOURCE_FILE = 'Invalid learning sourceFile';

export function safeLearningId(id: string): boolean {
  return /^[A-Za-z0-9._:-]{1,160}$/.test(id);
}

export function safeLearningSourceFile(sourceFile: string): string | null {
  const trimmed = sourceFile.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  const normalized = path.posix.normalize(trimmed.replaceAll('\\', '/'));
  if (path.posix.isAbsolute(normalized) || normalized === '.' || normalized === '..') return null;
  if (normalized.startsWith('../')) return null;
  return normalized;
}

export function learningSourcePath(sourceFile: string): string | null {
  const safeSourceFile = safeLearningSourceFile(sourceFile);
  if (!safeSourceFile) return null;
  const root = path.resolve(repoRoot());
  const filePath = path.resolve(root, safeSourceFile);
  return filePath.startsWith(root + path.sep) ? filePath : null;
}
