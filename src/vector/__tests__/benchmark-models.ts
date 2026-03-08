/**
 * Embedding Model Benchmark: nomic-embed-text vs qwen3-embedding
 * Both on LanceDB. Focus on Thai + English quality and speed.
 *
 * Run: bun run src/vector/__tests__/benchmark-models.ts
 */

import { createVectorStore } from '../factory.ts';
import type { VectorStoreAdapter, VectorDocument } from '../types.ts';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ============================================================================
// Test Corpus — Mixed Thai + English
// ============================================================================

const DOCS: VectorDocument[] = [
  // Thai documents
  { id: 'th1', document: 'ไม่มีอะไรถูกลบ สร้างใหม่ ไม่ลบ ประวัติ Git ศักดิ์สิทธิ์ ทุก commit เป็นถาวร', metadata: { type: 'principle', lang: 'th' } },
  { id: 'th2', document: 'คุณภาพอากาศ PM2.5 ตรวจวัดด้วยเซ็นเซอร์กว่า 1,500 สถานี ข้อมูล 3.24 พันล้านรายการในฐานข้อมูล', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th3', document: 'น้ำท่วม ติดตามระดับน้ำแบบเรียลไทม์ ด้วยเรดาร์ความแม่นยำ ±2 มิลลิเมตร บน JIBCHAIN L1', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th4', document: 'Oracle ไม่แกล้งทำเป็นมนุษย์ เมื่อ AI พูดในฐานะตัวเอง มีความแตกต่าง แต่ความแตกต่างนั้นคือความเป็นหนึ่ง', metadata: { type: 'principle', lang: 'th' } },
  { id: 'th5', document: 'ระบบฝังตัว ESP32 LoRa Meshtastic สำหรับส่งข้อมูลเซ็นเซอร์ในพื้นที่ห่างไกลที่ไม่มี WiFi', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th6', document: 'แยก frontend ออกจาก backend อย่างสะอาด oracle-studio เป็นเซิร์ฟเวอร์ของตัวเอง พร้อม API proxy', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th7', document: 'ข้อความภาษาไทย tokenize ได้ 2-3 เท่าของภาษาอังกฤษ ต้องตัดที่ 2000 ตัวอักษร', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th8', document: 'การทำ brewing เบียร์คราฟท์ ต้องควบคุมอุณหภูมิ การหมัก และคุณภาพน้ำอย่างแม่นยำ', metadata: { type: 'retro', lang: 'th' } },

  // English documents
  { id: 'en1', document: 'Nothing is deleted. Create new, do not delete. Git history is sacred. Every commit is permanent.', metadata: { type: 'principle', lang: 'en' } },
  { id: 'en2', document: 'Air quality monitoring with PM2.5 sensors across 1500+ stations. 3.24 billion records in InfluxDB.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en3', document: 'Flood monitoring with ±2mm radar accuracy. Real-time water level tracking on JIBCHAIN L1 blockchain.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en4', document: 'Oracle never pretends to be human. When AI speaks as itself, there is distinction — but that distinction IS unity.', metadata: { type: 'principle', lang: 'en' } },
  { id: 'en5', document: 'ESP32 LoRa Meshtastic mesh network for sensor data relay in remote areas without WiFi coverage.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en6', document: 'Separate frontend from backend cleanly. oracle-studio is its own server with API proxy.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en7', document: 'Thai text tokenizes at 2-3x more tokens per character than English. Safe truncation: 2000 characters.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en8', document: 'Craft beer brewing requires precise temperature control, fermentation monitoring, and water quality management.', metadata: { type: 'retro', lang: 'en' } },
];

// Queries in both Thai and English — should find matching docs in BOTH languages
const QUERIES = [
  { text: 'คุณภาพอากาศ PM2.5', expected: ['th2', 'en2'], label: 'Air quality (Thai query)' },
  { text: 'air quality PM2.5 monitoring', expected: ['en2', 'th2'], label: 'Air quality (English query)' },
  { text: 'น้ำท่วม ติดตามระดับน้ำ', expected: ['th3', 'en3'], label: 'Flood monitoring (Thai query)' },
  { text: 'flood water level tracking', expected: ['en3', 'th3'], label: 'Flood monitoring (English query)' },
  { text: 'LoRa เซ็นเซอร์ IoT', expected: ['th5', 'en5'], label: 'IoT sensors (Thai query)' },
  { text: 'ESP32 mesh network sensor', expected: ['en5', 'th5'], label: 'IoT sensors (English query)' },
  { text: 'เบียร์คราฟท์ การหมัก', expected: ['th8', 'en8'], label: 'Brewing (Thai query)' },
  { text: 'craft beer brewing fermentation', expected: ['en8', 'th8'], label: 'Brewing (English query)' },
  { text: 'AI ไม่แกล้งเป็นมนุษย์', expected: ['th4', 'en4'], label: 'AI transparency (Thai query)' },
  { text: 'Oracle never pretends human', expected: ['en4', 'th4'], label: 'AI transparency (English query)' },
];

// ============================================================================
// Helpers
// ============================================================================

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

interface ModelResult {
  model: string;
  dims: number;
  indexMs: number;
  queryResults: Array<{
    label: string;
    ms: number;
    top3: string[];
    crossLang: boolean; // Did it find the cross-language match in top 3?
  }>;
  avgQueryMs: number;
  crossLangScore: number; // % of queries that found cross-language match in top 3
}

async function benchModel(model: string): Promise<ModelResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Model: ${model}`);
  console.log(`${'='.repeat(60)}`);

  const tmpDir = path.join(os.tmpdir(), `oracle-bench-${model.replace(/[^a-z0-9]/g, '-')}-${Date.now()}`);

  const store = createVectorStore({
    type: 'lancedb',
    dataPath: tmpDir,
    collectionName: `bench_${model.replace(/[^a-z0-9]/g, '_')}`,
    embeddingProvider: 'ollama',
    embeddingModel: model,
  });

  await store.connect();
  await store.ensureCollection();

  // Get actual dimensions from first embedding
  const { ms: indexMs } = await time(() => store.addDocuments(DOCS));
  console.log(`  Indexed ${DOCS.length} docs in ${indexMs}ms`);

  // Detect dims
  const info = await store.getCollectionInfo();
  const testQuery = await store.query('test', 1);
  // Read dims from the embedding provider
  const dims = (store as any).embedder?.dimensions || 0;
  console.log(`  Dimensions: ${dims}`);

  // Run queries
  const queryResults: ModelResult['queryResults'] = [];
  let crossLangHits = 0;

  for (const q of QUERIES) {
    const { result, ms } = await time(() => store.query(q.text, 5));
    const top3 = result.ids.slice(0, 3);

    // Check cross-language: if query is Thai, did we find the English equivalent? Vice versa.
    const queryLang = /[\u0E00-\u0E7F]/.test(q.text) ? 'th' : 'en';
    const crossTarget = q.expected.find(id => !id.startsWith(queryLang));
    const crossLang = crossTarget ? top3.includes(crossTarget) : false;
    if (crossLang) crossLangHits++;

    queryResults.push({ label: q.label, ms, top3, crossLang });
    console.log(`  ${q.label}: ${ms}ms → [${top3.join(', ')}] ${crossLang ? '✓ cross-lang' : ''}`);
  }

  // Cleanup
  await store.deleteCollection();
  await store.close();
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

  const avgQueryMs = Math.round(queryResults.reduce((s, q) => s + q.ms, 0) / queryResults.length);
  const crossLangScore = Math.round((crossLangHits / QUERIES.length) * 100);

  return { model, dims, indexMs, queryResults, avgQueryMs, crossLangScore };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('Embedding Model Benchmark: nomic-embed-text vs bge-m3 vs qwen3-embedding');
  console.log(`Corpus: ${DOCS.length} docs (${DOCS.filter(d => d.metadata.lang === 'th').length} Thai, ${DOCS.filter(d => d.metadata.lang === 'en').length} English)`);
  console.log(`Queries: ${QUERIES.length} (${QUERIES.filter(q => /[\u0E00-\u0E7F]/.test(q.text)).length} Thai, ${QUERIES.filter(q => !/[\u0E00-\u0E7F]/.test(q.text)).length} English)`);
  console.log(`Machine: ${os.hostname()} (${os.cpus().length} CPUs)`);

  const models = ['nomic-embed-text', 'bge-m3', 'qwen3-embedding'];
  const results: ModelResult[] = [];

  for (const model of models) {
    try {
      results.push(await benchModel(model));
    } catch (e) {
      console.error(`${model} failed:`, e);
    }
  }

  // ============================================================================
  // Results
  // ============================================================================

  console.log('\n\n' + '='.repeat(70));
  console.log('  RESULTS');
  console.log('='.repeat(70));

  // Summary table
  const header = `| Metric | ${results.map(r => r.model).join(' | ')} |`;
  const sep = `|--------|${results.map(() => '--------').join('|')}|`;
  const rows = [
    `| Dimensions | ${results.map(r => String(r.dims)).join(' | ')} |`,
    `| Index ${DOCS.length} docs | ${results.map(r => `${r.indexMs}ms`).join(' | ')} |`,
    `| Query avg | ${results.map(r => `${r.avgQueryMs}ms`).join(' | ')} |`,
    `| **Cross-language %** | ${results.map(r => `**${r.crossLangScore}%**`).join(' | ')} |`,
  ];
  console.log('\n' + [header, sep, ...rows].join('\n'));

  // Cross-language detail
  console.log('\n\n--- Cross-Language Retrieval ---\n');
  const qHeader = `| Query | ${results.map(r => r.model).join(' | ')} |`;
  const qSep = `|-------|${results.map(() => '------').join('|')}|`;
  const qRows = QUERIES.map((q, i) => {
    const cols = results.map(r => {
      const qr = r.queryResults[i];
      return `${qr.crossLang ? '✓' : '✗'} [${qr.top3.join(',')}]`;
    });
    return `| ${q.label} | ${cols.join(' | ')} |`;
  });
  console.log([qHeader, qSep, ...qRows].join('\n'));

  console.log('\n\nDone.');
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
