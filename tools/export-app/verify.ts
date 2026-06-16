import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

type ManifestFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export interface ExportBundleVerification {
  ok: boolean;
  bundleDir: string;
  fileCount: number;
  errors: string[];
}

function containedPath(baseDir: string, relativePath: string): string | null {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relativePath);
  return resolved === resolvedBase || resolved.startsWith(`${resolvedBase}${path.sep}`) ? resolved : null;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function manifestFiles(value: unknown): ManifestFile[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { files?: unknown }).files)) {
    throw new Error('manifest.json missing files inventory');
  }
  return (value as { files: ManifestFile[] }).files;
}

export async function verifyExportBundle(bundleDir: string): Promise<ExportBundleVerification> {
  const root = path.resolve(bundleDir);
  const errors: string[] = [];
  let files: ManifestFile[] = [];

  try {
    files = manifestFiles(JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')));
  } catch (error) {
    return {
      ok: false,
      bundleDir: root,
      fileCount: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (!file || typeof file.path !== 'string' || typeof file.bytes !== 'number' || typeof file.sha256 !== 'string') {
      errors.push(`files[${index}]: invalid inventory entry`);
      continue;
    }
    const target = containedPath(root, file.path);
    if (!target) {
      errors.push(`${file.path}: escapes export bundle`);
      continue;
    }
    try {
      const [info, digest] = await Promise.all([stat(target), sha256(target)]);
      if (!info.isFile()) errors.push(`${file.path}: not a file`);
      if (info.size !== file.bytes) errors.push(`${file.path}: bytes ${info.size} !== ${file.bytes}`);
      if (digest !== file.sha256) errors.push(`${file.path}: sha256 ${digest} !== ${file.sha256}`);
    } catch (error) {
      errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: errors.length === 0, bundleDir: root, fileCount: files.length, errors };
}
