import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exportFileInventory, type ExportFileInventoryEntry } from './inventory.ts';

type JsonRecord = Record<string, unknown>;

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
  bytes?: number;
  relationshipFileCount?: number;
}

type Manifest = {
  exportedAt?: string;
  files?: ExportFileInventoryEntry[];
  formats?: unknown;
  backup?: { path?: unknown; tableCount?: unknown; rowCount?: unknown };
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

  const expected = manifestFiles(manifest, errors);
  const expectedPaths = new Set(expected.map((entry) => entry.path));
  const actual = await inventory(root, errors);
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  for (const entry of expected) verifyEntry(entry, actualByPath.get(entry.path), errors);
  for (const entry of actual) if (!expectedPaths.has(entry.path)) errors.push(`unexpected file not listed in manifest: ${entry.path}`);

  const formats = readFormats(manifest, errors);
  verifyBackup(manifest, expectedPaths, errors);
  const collectionCount = await verifyCollections(root, manifest, formats, expectedPaths, errors);
  const documentCount = await verifyDocuments(root, manifest, expectedPaths, errors);
  const relationshipFileCount = verifyRelationships(formats, expectedPaths, errors);

  return {
    ...result(root, errors, expected.length),
    exportedAt: manifest.exportedAt,
    collectionCount,
    rowCount: manifest.rowCount,
    relationshipCount: manifest.relationshipCount,
    documentCount,
    relationshipFileCount,
    bytes: expected.reduce((total, entry) => total + entry.bytes, 0),
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

function manifestFiles(manifest: Manifest, errors: string[]): ExportFileInventoryEntry[] {
  if (!Array.isArray(manifest.files)) { errors.push('manifest.files must be an array'); return []; }
  return manifest.files.filter((entry, index) => {
    const ok = entry && typeof entry.path === 'string' && typeof entry.bytes === 'number' && typeof entry.sha256 === 'string';
    if (!ok) errors.push(`manifest.files[${index}] must include path, bytes, and sha256`);
    return ok;
  });
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
  if (!actual) { errors.push(`missing file: ${expected.path}`); return; }
  if (actual.bytes !== expected.bytes) errors.push(`byte mismatch for ${expected.path}: expected ${expected.bytes}, got ${actual.bytes}`);
  if (actual.sha256 !== expected.sha256) errors.push(`sha256 mismatch for ${expected.path}`);
}

function readFormats(manifest: Manifest, errors: string[]): string[] {
  if (!Array.isArray(manifest.formats) || manifest.formats.some((format) => typeof format !== 'string')) {
    errors.push('manifest.formats must be a string array');
    return ['json', 'jsonl', 'csv', 'markdown'];
  }
  return manifest.formats;
}

function verifyBackup(manifest: Manifest, expectedPaths: Set<string>, errors: string[]): void {
  if (!manifest.backup) {
    errors.push('manifest.backup must be present');
    return;
  }
  if (typeof manifest.backup.path !== 'string') errors.push('manifest.backup.path must be a string');
  else expectManifestPath(expectedPaths, manifest.backup.path, errors);
  if (typeof manifest.backup.tableCount !== 'number') errors.push('manifest.backup.tableCount must be a number');
  if (typeof manifest.backup.rowCount !== 'number') errors.push('manifest.backup.rowCount must be a number');
}

async function verifyCollections(
  root: string,
  manifest: Manifest,
  formats: string[],
  expectedPaths: Set<string>,
  errors: string[],
): Promise<number | undefined> {
  const all = await readObject(path.join(root, 'all-collections.json'), 'all-collections.json', errors);
  const collections = record(all?.collections, 'all-collections.collections', errors);
  if (!collections) return manifest.collectionCount;
  const names = Object.keys(collections);
  if (manifest.collectionCount !== undefined && manifest.collectionCount !== names.length) {
    errors.push(`manifest collectionCount ${manifest.collectionCount} does not match ${names.length}`);
  }
  for (const name of names) {
    for (const format of formats) expectManifestPath(expectedPaths, `collections/${safeName(name)}.${extension(format)}`, errors);
  }
  return names.length;
}

async function verifyDocuments(
  root: string,
  manifest: Manifest,
  expectedPaths: Set<string>,
  errors: string[],
): Promise<number | undefined> {
  if ((manifest.documentCount ?? 0) === 0 && !expectedPaths.has('documents/index.json')) return manifest.documentCount;
  const index = await readObject(path.join(root, 'documents/index.json'), 'documents/index.json', errors);
  const docs = Array.isArray(index?.documents) ? index.documents : [];
  expectManifestPath(expectedPaths, 'documents/documents.csv', errors);
  for (const item of docs) {
    const doc = record(item, 'document index entry', errors);
    if (!doc) continue;
    for (const key of ['markdown', 'json']) {
      if (typeof doc[key] !== 'string') errors.push(`document index entry missing ${key}`);
      else expectManifestPath(expectedPaths, doc[key], errors);
    }
  }
  if (manifest.documentCount !== undefined && manifest.documentCount !== docs.length) {
    errors.push(`manifest documentCount ${manifest.documentCount} does not match ${docs.length}`);
  }
  return docs.length;
}

function verifyRelationships(formats: string[], expectedPaths: Set<string>, errors: string[]): number {
  for (const format of formats) expectManifestPath(expectedPaths, `relationships.${extension(format)}`, errors);
  return formats.length;
}

async function readObject(file: string, label: string, errors: string[]): Promise<JsonRecord | null> {
  try {
    return record(JSON.parse(await readFile(file, 'utf8')), label, errors);
  } catch (cause) {
    errors.push(`cannot read ${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return null;
  }
}

function record(value: unknown, label: string, errors: string[]): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  return value as JsonRecord;
}

function expectManifestPath(expectedPaths: Set<string>, file: string, errors: string[]): void {
  if (!expectedPaths.has(file)) errors.push(`required file missing from manifest: ${file}`);
}

function extension(format: string): string {
  return format === 'markdown' ? 'md' : format;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'row';
}

function result(root: string, errors: string[], checkedFiles: number): ExportBundleVerification {
  return { ok: errors.length === 0, bundleDir: root, checkedFiles, fileCount: checkedFiles, errors };
}
