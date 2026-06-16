import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { exportFileInventory, type ExportFileInventoryEntry } from './inventory.ts';

type JsonRecord = Record<string, unknown>;

export interface ExportBundleVerification {
  ok: boolean;
  bundleDir: string;
  fileCount: number;
  checkedFiles: number;
  bytes: number;
  collectionCount: number;
  documentCount: number;
  relationshipFileCount: number;
  errors: string[];
}

interface VerifyState { checkedFiles: number }
interface ExportManifest {
  collectionCount?: number;
  documentCount?: number;
  formats?: unknown;
  files?: ExportFileInventoryEntry[];
}

function containedPath(baseDir: string, relativePath: string): string | null {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relativePath);
  return resolved === resolvedBase || resolved.startsWith(`${resolvedBase}${path.sep}`) ? resolved : null;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function readJson(root: string, relativePath: string, errors: string[], state: VerifyState): Promise<unknown> {
  const target = containedPath(root, relativePath);
  if (!target) { errors.push(`${relativePath}: escapes export bundle`); return null; }
  try {
    state.checkedFiles += 1;
    return JSON.parse(await readFile(target, 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function requireFile(root: string, relativePath: string, errors: string[], state: VerifyState): Promise<void> {
  const target = containedPath(root, relativePath);
  if (!target) { errors.push(`${relativePath}: escapes export bundle`); return; }
  try {
    const info = await stat(target);
    state.checkedFiles += 1;
    if (!info.isFile()) errors.push(`${relativePath}: not a file`);
  } catch (error) {
    errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function record(value: unknown, label: string, errors: string[]): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  return value as JsonRecord;
}

function stringArray(value: unknown, label: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    errors.push(`${label} must be a string array`);
    return [];
  }
  return value;
}

function ext(format: string): string {
  return format === 'markdown' ? 'md' : format;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'row';
}

function manifestFiles(manifest: ExportManifest, errors: string[]): ExportFileInventoryEntry[] {
  if (!Array.isArray(manifest.files)) { errors.push('manifest.json missing files inventory'); return []; }
  return manifest.files.filter((file, index) => {
    const valid = file && typeof file.path === 'string' && typeof file.bytes === 'number' && typeof file.sha256 === 'string';
    if (!valid) errors.push(`files[${index}]: invalid inventory entry`);
    return valid;
  });
}

async function verifyInventory(root: string, files: ExportFileInventoryEntry[], errors: string[], state: VerifyState): Promise<number> {
  const expected = new Map(files.map((file) => [file.path, file]));
  for (const file of files) {
    const target = containedPath(root, file.path);
    if (!target) { errors.push(`${file.path}: escapes export bundle`); continue; }
    try {
      const [info, digest] = await Promise.all([stat(target), sha256(target)]);
      state.checkedFiles += 1;
      if (!info.isFile()) errors.push(`${file.path}: not a file`);
      if (info.size !== file.bytes) errors.push(`${file.path}: size mismatch ${info.size} !== ${file.bytes}`);
      if (digest !== file.sha256) errors.push(`${file.path}: checksum mismatch ${digest} !== ${file.sha256}`);
    } catch (error) {
      errors.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const file of await exportFileInventory(root, { exclude: ['manifest.json'] })) {
    if (!expected.has(file.path)) errors.push(`${file.path}: unexpected file`);
  }
  return files.reduce((total, file) => total + file.bytes, 0);
}

async function verifyCollections(root: string, collections: JsonRecord, formats: string[], errors: string[], state: VerifyState): Promise<void> {
  for (const name of Object.keys(collections)) {
    for (const format of formats) await requireFile(root, `collections/${safeName(name)}.${ext(format)}`, errors, state);
  }
}

async function verifyRelationships(root: string, formats: string[], errors: string[], state: VerifyState): Promise<number> {
  for (const format of formats) await requireFile(root, `relationships.${ext(format)}`, errors, state);
  return formats.length;
}

async function verifyDocuments(root: string, errors: string[], state: VerifyState): Promise<number> {
  const rawIndex = await readJson(root, 'documents/index.json', errors, state);
  const index = record(rawIndex, 'documents/index.json', errors);
  if (!index) return 0;
  const docs = Array.isArray(index.documents) ? index.documents : [];
  await requireFile(root, 'documents/documents.csv', errors, state);
  for (const item of docs) {
    const doc = record(item, 'document index entry', errors);
    if (!doc) continue;
    for (const key of ['markdown', 'json']) {
      if (typeof doc[key] !== 'string') errors.push(`document index entry missing ${key}`);
      else await requireFile(root, doc[key], errors, state);
    }
  }
  return docs.length;
}

export async function verifyExportBundle(bundleDir: string): Promise<ExportBundleVerification> {
  const root = path.resolve(bundleDir);
  const errors: string[] = [];
  const state = { checkedFiles: 0 };
  const manifest = record(await readJson(root, 'manifest.json', errors, state), 'manifest', errors) as ExportManifest | null;
  if (!manifest) return emptyResult(root, errors, state);

  const files = manifestFiles(manifest, errors);
  const formats = stringArray(manifest.formats, 'manifest.formats', errors);
  const all = record(await readJson(root, 'all-collections.json', errors, state), 'all-collections', errors);
  const collections = all ? record(all.collections, 'all-collections.collections', errors) : null;
  const collectionNames = collections ? Object.keys(collections) : [];

  if (manifest.collectionCount !== undefined && manifest.collectionCount !== collectionNames.length) {
    errors.push(`manifest collectionCount ${manifest.collectionCount} does not match ${collectionNames.length}`);
  }

  if (collections) await verifyCollections(root, collections, formats, errors, state);
  const relationshipFileCount = await verifyRelationships(root, formats, errors, state);
  const documentCount = await verifyDocuments(root, errors, state);
  if (manifest.documentCount !== undefined && manifest.documentCount !== documentCount) {
    errors.push(`manifest documentCount ${manifest.documentCount} does not match ${documentCount}`);
  }
  const bytes = await verifyInventory(root, files, errors, state);
  return {
    ok: errors.length === 0,
    bundleDir: root,
    fileCount: files.length,
    checkedFiles: state.checkedFiles,
    bytes,
    collectionCount: collectionNames.length,
    documentCount,
    relationshipFileCount,
    errors,
  };
}

function emptyResult(root: string, errors: string[], state: VerifyState): ExportBundleVerification {
  return { ok: false, bundleDir: root, fileCount: 0, checkedFiles: state.checkedFiles, bytes: 0, collectionCount: 0, documentCount: 0, relationshipFileCount: 0, errors };
}
