/** checkOssie restates the apache/ossie ontology rules; ossieStatus pairs it with the last real validator run. */
import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { arraOntology } from '../ontology.ts';
import { checkOssie, ossieHash, ossieStatus, VALIDATION_FILE } from '../ossie-check.ts';

describe('checkOssie', () => {
  test('the arra ontology passes', () => {
    const r = checkOssie(arraOntology());
    expect(r).toMatchObject({ ok: true, errors: [] });
    expect(r.concepts).toBeGreaterThan(10);
    expect(r.relationships).toBeGreaterThan(10);
  });
  test('it catches what the official validator rejects', () => {
    const o = arraOntology();
    o.ontology.push({ ...o.ontology[0] });
    const doc = o.ontology.find((c) => c.concept === 'Document')!;
    doc.relationships![0].roles = [{ concept: 'Nowhere' }];
    doc.relationships![1].verbalizes = ['{Document} floats'];
    o.version = '0.2';
    const r = checkOssie(o);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('duplicate concept DocId');
    expect(r.errors.join('\n')).toContain('role Nowhere is unknown');
    expect(r.errors.join('\n')).toContain('does not name its roles');
    expect(r.errors.join('\n')).toContain('version is 0.2');
  });
});

describe('ossieStatus', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-ossie-status-'));
  test('no validator run yet', () => {
    const s = ossieStatus(dir);
    expect(s.official).toBeNull();
    expect(s.url).toBe('/api/arra/ontology?format=ossie');
    expect(s.sha256).toBe(ossieHash(arraOntology()));
  });
  test('a recorded run says whether it validated this export', () => {
    const rec = { at: '2026-11-25T02:00:00Z', passed: true, ossieRef: 'd27a6be', sha256: ossieHash(arraOntology()) };
    fs.writeFileSync(path.join(dir, VALIDATION_FILE), JSON.stringify(rec));
    expect(ossieStatus(dir).official).toMatchObject({ passed: true, current: true });
    fs.writeFileSync(path.join(dir, VALIDATION_FILE), JSON.stringify({ ...rec, sha256: 'old' }));
    expect(ossieStatus(dir).official).toMatchObject({ passed: true, current: false });
  });
});
