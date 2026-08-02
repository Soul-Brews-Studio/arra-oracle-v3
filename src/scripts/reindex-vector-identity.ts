#!/usr/bin/env bun
import * as lancedb from '@lancedb/lancedb';
import type { Table } from '@lancedb/lancedb';
import { sqlite } from '../db/index.ts';
import { LANCEDB_DIR } from '../config.ts';
import { canonicalProject, contentDigest } from '../document-identity.ts';
import { OllamaEmbeddings } from '../vector/embeddings.ts';
import { getEmbeddingModels } from '../vector/factory.ts';

const SOURCE_COLLECTION = 'oracle_knowledge_qwen3';
const TARGET_COLLECTION = getEmbeddingModels().qwen3.collection;
const PAGE_SIZE = 250;
const EMBED_BATCH_SIZE = 50;
const MIN_COMPATIBILITY_COSINE = 0.999;
const embeddingModel = getEmbeddingModels().qwen3.model;
const embedder = new OllamaEmbeddings({ model: embeddingModel });

interface DocumentRow {
  id: string;
  display_id: string;
  content_digest: string;
  type: string;
  source_file: string;
  concepts: string;
  project: string | null;
  content: string;
}

interface VectorRow {
  id: string;
  text: string;
  metadata: string;
  vector: Iterable<number>;
}

const projectKey = (project: string | null | undefined) => canonicalProject(project);
const documentKey = (project: string | null | undefined, displayId: string) => `${projectKey(project)}\0${displayId}`;
const vectorMetadata = (document: DocumentRow) => ({
  type: document.type,
  source_file: document.source_file,
  concepts: document.concepts,
  project: projectKey(document.project),
  display_id: document.display_id,
  content_digest: document.content_digest,
});
const lanceRow = (document: DocumentRow, vector: number[] | Float32Array) => ({
  id: document.id,
  text: document.content,
  type: document.type,
  project: projectKey(document.project),
  display_id: document.display_id,
  content_digest: document.content_digest,
  metadata: JSON.stringify(vectorMetadata(document)),
  vector,
});

const cosine = (left: number[], right: number[]) => {
  if (left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
};
const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every(item => typeof item === 'number');


const legacyEmbed = async (text: string) => {
  const response = await fetch('http://127.0.0.1:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: embeddingModel, prompt: text.length > 2000 ? text.slice(0, 2000) : text }),
  });
  if (!response.ok) throw new Error(`Legacy Ollama API error: ${await response.text()}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('embedding' in payload) || !isNumberArray(payload.embedding)) {
    throw new Error('Legacy Ollama API returned an invalid embedding');
  }
  return payload.embedding;
};

const documents = sqlite.prepare(`
  SELECT d.id, d.display_id, d.content_digest, d.type, d.source_file,
         d.concepts, d.project, f.content
  FROM oracle_documents d
  JOIN oracle_fts f ON f.id = d.id
  ORDER BY d.id
`).all() as DocumentRow[];
const byIdentity = new Map(documents.map(document => [documentKey(document.project, document.display_id), document]));
const byDisplay = new Map<string, DocumentRow | null>();
for (const document of documents) {
  byDisplay.set(document.display_id, byDisplay.has(document.display_id) ? null : document);
}

const db = await lancedb.connect(LANCEDB_DIR);
const tableNames = await db.tableNames();
if (!tableNames.includes(SOURCE_COLLECTION)) throw new Error(`Missing source collection: ${SOURCE_COLLECTION}`);
const source = await db.openTable(SOURCE_COLLECTION);
const [storedSample] = await source.query().limit(1).toArray() as unknown as VectorRow[];
const compatibilityTexts = [
  'Pump discharge pressure review before commissioning.',
  'ตรวจสอบความดันด้านจ่ายของปั๊มก่อนเริ่มเดินเครื่อง',
  '调试前检查泵出口压力。',
  storedSample.text,
];
const currentVectors = await embedder.embed(compatibilityTexts);
const legacyVectors = await Promise.all(compatibilityTexts.map(legacyEmbed));
const endpointCosines = legacyVectors.map((vector, index) => cosine(vector, currentVectors[index]));
const storedVector = Array.from(storedSample.vector);
const storedCosines = [
  cosine(storedVector, legacyVectors[3]),
  cosine(storedVector, currentVectors[3]),
];
const compatibility = { endpoint_cosines: endpointCosines, stored_cosines: storedCosines };
if ([...endpointCosines, ...storedCosines].some(value => value < MIN_COMPATIBILITY_COSINE)) {
  throw new Error(`Embedding pipelines are incompatible: ${JSON.stringify(compatibility)}`);
}
console.error(`Embedding compatibility verified: ${JSON.stringify(compatibility)}`);
if (process.argv.includes('--compat-only')) {
  console.log(JSON.stringify(compatibility));
  sqlite.close();
  process.exit(0);
}

if (tableNames.includes(TARGET_COLLECTION)) await db.dropTable(TARGET_COLLECTION);

let target: Table | null = null;
let reused = 0;
let stale = 0;
let unmapped = 0;
const indexedIds = new Set<string>();
const sourceCount = await source.countRows();

for (let offset = 0; offset < sourceCount; offset += PAGE_SIZE) {
  const rows = await source.query().offset(offset).limit(PAGE_SIZE).toArray() as unknown as VectorRow[];
  const output = [];
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata || '{}') as { project?: string };
    const document = byIdentity.get(documentKey(metadata.project, row.id)) || byDisplay.get(row.id);
    if (!document) {
      unmapped++;
      continue;
    }
    if (indexedIds.has(document.id)) continue;
    if (contentDigest(row.text) !== document.content_digest) {
      stale++;
      continue;
    }
    indexedIds.add(document.id);
    output.push(lanceRow(document, Array.from(row.vector)));
  }
  if (output.length > 0) {
    if (target) await target.add(output);
    else target = await db.createTable(TARGET_COLLECTION, output);
    reused += output.length;
  }
  console.error(`Reused ${reused}/${sourceCount} legacy vectors`);
}

const missing = documents.filter(document => !indexedIds.has(document.id));
for (let offset = 0; offset < missing.length; offset += EMBED_BATCH_SIZE) {
  const batch = missing.slice(offset, offset + EMBED_BATCH_SIZE);
  const vectors = await embedder.embed(batch.map(document => document.content));
  const output = batch.map((document, index) => lanceRow(document, vectors[index]));
  if (target) await target.add(output);
  else target = await db.createTable(TARGET_COLLECTION, output);
  console.error(`Embedded ${Math.min(offset + batch.length, missing.length)}/${missing.length} missing vectors`);
}

if (!target) throw new Error('No vectors written');
const finalCount = await target.countRows();
console.log(JSON.stringify({
  source_collection: SOURCE_COLLECTION,
  target_collection: TARGET_COLLECTION,
  source_count: sourceCount,
  reused,
  reembedded: missing.length,
  stale,
  unmapped,
  final_count: finalCount,
  expected_count: documents.length,
  complete: finalCount === documents.length,
}));
sqlite.close();
