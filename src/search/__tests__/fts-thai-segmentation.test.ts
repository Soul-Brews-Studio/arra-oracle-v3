import { expect, test } from 'bun:test';
import { segmentThaiText } from '../fts-text.ts';
import { sanitizeFtsQuery } from '../../tools/search/helpers.ts';
import { buildTenantFtsQuery } from '../query.ts';
import { buildFtsQuery } from '../../server/handlers.ts';

test('Thai words are separated without losing vowel or tone marks', () => {
  expect(segmentThaiText('ฉันชอบภาษาไทยและการเขียนโปรแกรม'))
    .toBe('ฉัน ชอบ ภาษา ไทย และ การ เขียน โปรแกรม');
  expect(segmentThaiText('บัญชียิ้ม')).toBe('บัญชี ยิ้ม');
});

test('non-Thai text passes through byte-identically', () => {
  const text = '  deploying memory\tdocker\r\nCafe\u0301 🐳 foo_bar! 中文';
  expect(segmentThaiText(text)).toBe(text);
});

test('mixed script boundaries separate words and retain formatting', () => {
  expect(segmentThaiText('deployภาษาไทยdocker\n  ยิ้ม!'))
    .toBe('deploy ภาษา ไทย docker\n  ยิ้ม!');
});

test('all builders preserve Thai marks and quote segmented runs as ordered phrases', () => {
  for (const build of [sanitizeFtsQuery, buildTenantFtsQuery, buildFtsQuery]) {
    expect(build('ภาษาไทย')).toBe('"ภาษา ไทย"');
    expect(build('บัญชี ยิ้ม โปรแกรม')).toBe('"บัญชี" OR "ยิ้ม" OR "โปรแกรม"');
    expect(build('ภาษาไทยdeploy')).toBe('"ภาษา ไทย" OR "deploy"');
    expect(build('จำ')).toBe('"จำ"'); // NFKC would change SARA AM.
    expect(build('pane_pid')).toBe('"pane" OR "pid"');
  }
});
