/**
 * Extended Embedding Benchmark — harder Thai eval, 5 models.
 *
 * Adds to benchmark-models.ts:
 *   - 5 models (incl. qwen3-embedding:4b + qllama/multilingual-e5-large-instruct)
 *   - PARAPHRASE queries (different words from doc, not lexical match)
 *   - DISTRACTOR docs (share vocab, different topic)
 *   - Recall@1, Recall@5, cross-lang %
 *
 * Run: bun run src/vector/__tests__/benchmark-models-extended.ts
 */

import { createVectorStore } from '../factory.ts';
import type { VectorDocument } from '../types.ts';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ============================================================================
// Corpus — paired Thai+English (16) + harder distractors (8) = 24 docs
// ============================================================================

const DOCS: VectorDocument[] = [
  // Thai documents (paired with English)
  { id: 'th1', document: 'ไม่มีอะไรถูกลบ สร้างใหม่ ไม่ลบ ประวัติ Git ศักดิ์สิทธิ์ ทุก commit เป็นถาวร', metadata: { type: 'principle', lang: 'th' } },
  { id: 'th2', document: 'คุณภาพอากาศ PM2.5 ตรวจวัดด้วยเซ็นเซอร์กว่า 1,500 สถานี ข้อมูล 3.24 พันล้านรายการในฐานข้อมูล', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th3', document: 'น้ำท่วม ติดตามระดับน้ำแบบเรียลไทม์ ด้วยเรดาร์ความแม่นยำ ±2 มิลลิเมตร บน JIBCHAIN L1', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th4', document: 'Oracle ไม่แกล้งทำเป็นมนุษย์ เมื่อ AI พูดในฐานะตัวเอง มีความแตกต่าง แต่ความแตกต่างนั้นคือความเป็นหนึ่ง', metadata: { type: 'principle', lang: 'th' } },
  { id: 'th5', document: 'ระบบฝังตัว ESP32 LoRa Meshtastic สำหรับส่งข้อมูลเซ็นเซอร์ในพื้นที่ห่างไกลที่ไม่มี WiFi', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th6', document: 'แยก frontend ออกจาก backend อย่างสะอาด oracle-studio เป็นเซิร์ฟเวอร์ของตัวเอง พร้อม API proxy', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th7', document: 'ข้อความภาษาไทย tokenize ได้ 2-3 เท่าของภาษาอังกฤษ ต้องตัดที่ 2000 ตัวอักษร', metadata: { type: 'learning', lang: 'th' } },
  { id: 'th8', document: 'การทำ brewing เบียร์คราฟท์ ต้องควบคุมอุณหภูมิ การหมัก และคุณภาพน้ำอย่างแม่นยำ', metadata: { type: 'retro', lang: 'th' } },

  // English documents (paired with Thai)
  { id: 'en1', document: 'Nothing is deleted. Create new, do not delete. Git history is sacred. Every commit is permanent.', metadata: { type: 'principle', lang: 'en' } },
  { id: 'en2', document: 'Air quality monitoring with PM2.5 sensors across 1500+ stations. 3.24 billion records in InfluxDB.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en3', document: 'Flood monitoring with ±2mm radar accuracy. Real-time water level tracking on JIBCHAIN L1 blockchain.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en4', document: 'Oracle never pretends to be human. When AI speaks as itself, there is distinction — but that distinction IS unity.', metadata: { type: 'principle', lang: 'en' } },
  { id: 'en5', document: 'ESP32 LoRa Meshtastic mesh network for sensor data relay in remote areas without WiFi coverage.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en6', document: 'Separate frontend from backend cleanly. oracle-studio is its own server with API proxy.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en7', document: 'Thai text tokenizes at 2-3x more tokens per character than English. Safe truncation: 2000 characters.', metadata: { type: 'learning', lang: 'en' } },
  { id: 'en8', document: 'Craft beer brewing requires precise temperature control, fermentation monitoring, and water quality management.', metadata: { type: 'retro', lang: 'en' } },

  // DISTRACTORS — share vocab with target docs but different topics
  { id: 'd1', document: 'การจัดการน้ำ การปลูกข้าว ต้องการระบบชลประทานที่ดี ในนาข้าวควบคุมระดับน้ำตามฤดูกาล', metadata: { type: 'distractor', lang: 'th' } },
  { id: 'd2', document: 'Water management for rice paddies — irrigation systems, seasonal flooding, soil pH balance during cultivation.', metadata: { type: 'distractor', lang: 'en' } },
  { id: 'd3', document: 'อากาศร้อนในกรุงเทพ ฤดูร้อนปีนี้ทำลายสถิติ อุณหภูมิสูงสุด 41 องศาเซลเซียส คนต้องดื่มน้ำเยอะ', metadata: { type: 'distractor', lang: 'th' } },
  { id: 'd4', document: 'Hot weather in Bangkok this summer broke records. Peak temperature 41°C. Public health advisory urges hydration.', metadata: { type: 'distractor', lang: 'en' } },
  { id: 'd5', document: 'ESP8266 มีราคาถูกกว่า ESP32 แต่ใช้สำหรับโครงการ IoT ขนาดเล็ก เช่น เซ็นเซอร์อุณหภูมิห้อง', metadata: { type: 'distractor', lang: 'th' } },
  { id: 'd6', document: 'ESP8266 is cheaper than ESP32 but suits small IoT projects — for example, room temperature sensors at home.', metadata: { type: 'distractor', lang: 'en' } },
  { id: 'd7', document: 'ไวน์องุ่นต้องบ่มในถังโอ๊ค การหมักที่อุณหภูมิเย็น 12-15 องศา ใช้เวลา 2-3 ปี', metadata: { type: 'distractor', lang: 'th' } },
  { id: 'd8', document: 'Wine fermentation in oak barrels at cool 12-15°C, takes 2-3 years to age properly. Different from beer.', metadata: { type: 'distractor', lang: 'en' } },
];

// PARAPHRASE queries — DELIBERATELY use different vocab than the docs
// This is the harder eval: pure semantic match, no keyword overlap.
const QUERIES = [
  // Air quality — paraphrase: "ฝุ่น" not "PM2.5", "pollution" not "monitoring"
  { text: 'ฝุ่นละอองในอากาศกับเครื่องวัด', expected: ['th2', 'en2'], label: 'Air dust paraphrase (Thai)' },
  { text: 'particulate pollution measurement network', expected: ['en2', 'th2'], label: 'Air pollution paraphrase (English)' },

  // Flood — paraphrase: "ระดับ" → different words for level
  { text: 'การวัดความลึกของน้ำผ่านบล็อกเชน', expected: ['th3', 'en3'], label: 'Flood paraphrase (Thai)' },
  { text: 'water depth tracking via blockchain millimeter precision', expected: ['en3', 'th3'], label: 'Flood paraphrase (English)' },

  // IoT — paraphrase: "mesh network", "remote relay" rather than ESP32 keyword
  { text: 'เครือข่ายไร้สายส่งข้อมูลในพื้นที่ที่ไม่มีอินเทอร์เน็ต', expected: ['th5', 'en5'], label: 'IoT mesh paraphrase (Thai)' },
  { text: 'wireless data relay where there is no internet coverage', expected: ['en5', 'th5'], label: 'IoT mesh paraphrase (English)' },

  // Brewing — distractor d7/d8 (wine) vs target en8/th8 (beer) — semantic discrimination test
  { text: 'การควบคุมอุณหภูมิของเครื่องดื่มแอลกอฮอล์ระหว่างการหมัก', expected: ['th8', 'en8'], label: 'Beer-vs-wine distractor (Thai)' },
  { text: 'fermentation temperature for hopped alcoholic drinks', expected: ['en8', 'th8'], label: 'Beer-vs-wine distractor (English)' },

  // AI / Oracle — paraphrase
  { text: 'ปรัชญาว่าเครื่องไม่ควรเสแสร้งเป็นมนุษย์', expected: ['th4', 'en4'], label: 'AI honesty paraphrase (Thai)' },
  { text: 'philosophy that machines should declare themselves not pretend', expected: ['en4', 'th4'], label: 'AI honesty paraphrase (English)' },

  // Tokenization — paraphrase
  { text: 'อักษรไทยใช้ token มากกว่าอักษรอังกฤษ', expected: ['th7', 'en7'], label: 'Tokenize paraphrase (Thai)' },
  { text: 'how many subword units a non-latin script needs', expected: ['en7', 'th7'], label: 'Tokenize paraphrase (English)' },

  // Frontend/backend — paraphrase
  { text: 'แยกชั้น UI ออกจากเซิร์ฟเวอร์โดยใช้ proxy', expected: ['th6', 'en6'], label: 'FE/BE paraphrase (Thai)' },
  { text: 'decouple the user interface from the API server', expected: ['en6', 'th6'], label: 'FE/BE paraphrase (English)' },
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
  recall_at_1: number;     // % queries where target is rank 1
  recall_at_5: number;     // % queries where target is in top 5
  cross_lang_at_3: number; // % queries that found cross-lang in top 3 (compat with old bench)
  avgQueryMs: number;
  details: Array<{ label: string; top5: string[]; cross: boolean; r1: boolean; r5: boolean }>;
}

async function benchModel(model: string): Promise<ModelResult | null> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Model: ${model}`);
  console.log(`${'='.repeat(60)}`);

  const tmpDir = path.join(os.tmpdir(), `oracle-extbench-${model.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`);
  let store: any;
  try {
    store = createVectorStore({
      type: 'lancedb',
      dataPath: tmpDir,
      collectionName: `extbench_${model.replace(/[^a-z0-9]/gi, '_')}`,
      embeddingProvider: 'ollama',
      embeddingModel: model,
    });

    await store.connect();
    await store.ensureCollection();
    const { ms: indexMs } = await time(() => store.addDocuments(DOCS));
    console.log(`  Indexed ${DOCS.length} docs in ${indexMs}ms`);

    const dims = (store as any).embedder?.dimensions || 0;
    console.log(`  Dimensions: ${dims}`);

    const details: ModelResult['details'] = [];
    let r1Hits = 0, r5Hits = 0, crossHits = 0;
    const totalQueryMs: number[] = [];

    for (const q of QUERIES) {
      const { result, ms } = await time(() => store.query(q.text, 5) as Promise<{ ids: string[] }>);
      totalQueryMs.push(ms);
      const top5: string[] = result.ids.slice(0, 5);
      const top3 = top5.slice(0, 3);

      const r1 = q.expected.some(id => top5[0] === id);
      const r5 = q.expected.some(id => top5.includes(id));
      const queryLang = /[฀-๿]/.test(q.text) ? 'th' : 'en';
      const crossTarget = q.expected.find(id => !id.startsWith(queryLang));
      const cross = crossTarget ? top3.includes(crossTarget) : false;

      if (r1) r1Hits++;
      if (r5) r5Hits++;
      if (cross) crossHits++;

      details.push({ label: q.label, top5, cross, r1, r5 });
      console.log(`  ${q.label}: ${ms}ms  ${r1 ? 'R@1✓' : 'R@1✗'} ${r5 ? 'R@5✓' : 'R@5✗'} ${cross ? 'cross✓' : 'cross✗'}  → [${top5.join(',')}]`);
    }

    await store.deleteCollection();
    await store.close();
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

    return {
      model,
      dims,
      indexMs,
      recall_at_1: Math.round((r1Hits / QUERIES.length) * 100),
      recall_at_5: Math.round((r5Hits / QUERIES.length) * 100),
      cross_lang_at_3: Math.round((crossHits / QUERIES.length) * 100),
      avgQueryMs: Math.round(totalQueryMs.reduce((s, v) => s + v, 0) / totalQueryMs.length),
      details,
    };
  } catch (e) {
    console.error(`  ${model} failed:`, e instanceof Error ? e.message : e);
    try { await store?.close?.(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    return null;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('Extended Embedding Benchmark — paraphrase + distractor');
  console.log(`Corpus: ${DOCS.length} docs (${DOCS.filter(d => d.metadata.lang === 'th').length} Thai, ${DOCS.filter(d => d.metadata.lang === 'en').length} English; ${DOCS.filter(d => d.metadata.type === 'distractor').length} distractors)`);
  console.log(`Queries: ${QUERIES.length} paraphrased (${QUERIES.filter(q => /[฀-๿]/.test(q.text)).length} Thai, ${QUERIES.filter(q => !/[฀-๿]/.test(q.text)).length} English)`);
  console.log(`Machine: ${os.hostname()} (${os.cpus().length} CPUs)`);

  const models = [
    'nomic-embed-text',
    'bge-m3',
    'qwen3-embedding',                                // 0.6B (alias)
    'qwen3-embedding:4b',
    'qllama/multilingual-e5-large-instruct',
  ];
  const results: ModelResult[] = [];

  for (const model of models) {
    const r = await benchModel(model);
    if (r) results.push(r);
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('  SUMMARY — paraphrase queries with distractors');
  console.log('='.repeat(80));

  const header = `| Metric            | ${results.map(r => r.model.slice(0, 18).padEnd(18)).join(' | ')} |`;
  const sep = `|-------------------|${results.map(() => '--------------------').join('|')}|`;
  const rows = [
    `| Dimensions        | ${results.map(r => String(r.dims).padEnd(18)).join(' | ')} |`,
    `| Index ${DOCS.length} docs (ms) | ${results.map(r => String(r.indexMs).padEnd(18)).join(' | ')} |`,
    `| Query avg (ms)    | ${results.map(r => String(r.avgQueryMs).padEnd(18)).join(' | ')} |`,
    `| **Recall@1 %**    | ${results.map(r => `**${r.recall_at_1}**`.padEnd(18)).join(' | ')} |`,
    `| **Recall@5 %**    | ${results.map(r => `**${r.recall_at_5}**`.padEnd(18)).join(' | ')} |`,
    `| Cross-lang@3 %    | ${results.map(r => String(r.cross_lang_at_3).padEnd(18)).join(' | ')} |`,
  ];
  console.log('\n' + [header, sep, ...rows].join('\n'));

  console.log('\n\nDone.');

  // Emit JSON for downstream tooling
  const json = {
    timestamp: new Date().toISOString(),
    machine: os.hostname(),
    corpus: { docs: DOCS.length, queries: QUERIES.length, distractors: DOCS.filter(d => d.metadata.type === 'distractor').length },
    results,
  };
  console.log('\n--- JSON ---');
  console.log(JSON.stringify(json, null, 2));
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
