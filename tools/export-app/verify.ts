import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exportFileInventory, type ExportFileInventoryEntry } from './inventory.ts';

export interface ExportBundleVerification {
  ok: boolean;
  bundleDir: string;
  checkedFiles: number;
  fileCount: number;
  errors: string[];
  exportedAt?: string;
  collectionCount?: number;
  rowCount?: number;
  relationshipCount?: number;
  documentCount?: number;
}

type Manifest = {
  exportedAt?: string;
  files?: ExportFileInventoryEntry[];
  collectionCount?: number;
  rowCount?: number;
  relationshipCount?: number;
  documentCount?: number;
};

export async function verifyExportBundle(bundleDir: string): Promise<ExportBundleVerification> {
  const root = path.resolve(bundleDir);
  const errors: string[] = [];
  const manifest = await readManifest(path.join(root, 'manifest.json'), errors);
  if (!manifest) return result(root, errors, 0);

  const expected = Array.isArray(manifest.files) ? manifest.files : [];
  if (!Array.isArray(manifest.files)) errors.push('manifest.files must be an array');
  const actual = await inventory(root, errors);
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const expectedPaths = new Set(expected.map((entry) => entry.path));

  for (const entry of expected) verifyEntry(entry, actualByPath.get(entry.path), errors);
  for (const entry of actual) {
    if (!expectedPaths.has(entry.path)) errors.push(`unexpected file not listed in manifest: ${entry.path}`);
  }
  for (const file of requiredFiles(manifest)) {
    if (!expectedPaths.has(file)) errors.push(`required file missing from manifest: ${file}`);
  }

  return {
    ...result(root, errors, expected.length),
    exportedAt: manifest.exportedAt,
    collectionCount: manifest.collectionCount,
    rowCount: manifest.rowCount,
    relationshipCount: manifest.relationshipCount,
    documentCount: manifest.documentCount,
  };
}

async function readManifest(file: string, errors: string[]): Promise<Manifest | null> {
  try {
    const manifest = JSON.parse(await readFile(file, 'utf8')) as Manifest;
    if (!manifest || typeof manifest !== 'object') {
      errors.push('manifest.json must contain an object');
      return null;
    }
    return manifest;
  } catch (cause) {
    errors.push(`cannot read manifest.json: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

async function inventory(root: string, errors: string[]): Promise<ExportFileInventoryEntry[]> {
  try {
    return await exportFileInventory(root, { exclude: ['manifest.json'] });
  } catch (cause) {
    errors.push(`cannot inventory bundle: ${cause instanceof Error ? cause.message : String(cause)}`);
    return [];
  }
}

function verifyEntry(expected: ExportFileInventoryEntry, actual: ExportFileInventoryEntry | undefined, errors: string[]): void {
  if (!actual) {
    errors.push(`missing file: ${expected.path}`);
    return;
  }
  if (actual.bytes !== expected.bytes) {
    errors.push(`byte mismatch for ${expected.path}: expected ${expected.bytes}, got ${actual.bytes}`);
  }
  if (actual.sha256 !== expected.sha256) errors.push(`sha256 mismatch for ${expected.path}`);
}

function requiredFiles(manifest: Manifest): string[] {
  const formats = ['json', 'csv', 'md'];
  return [
    'README.md',
    'all-collections.json',
    'manifest.schema.json',
    'documents/index.json',
    'documents/documents.csv',
    ...formats.map((format) => `relationships.${format}`),
  ].filter((file) => manifest.documentCount !== 0 || !file.startsWith('documents/'));
}

function result(root: string, errors: string[], checkedFiles: number): ExportBundleVerification {
  return { ok: errors.length === 0, bundleDir: root, checkedFiles, fileCount: checkedFiles, errors };
}
