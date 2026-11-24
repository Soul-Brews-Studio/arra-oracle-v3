/**
 * `arra retire <thing> --successor <x|nothing> --why "..."` — cease by hand, with a record.
 *
 * arise · stand · cease: nothing is removed automatically. Ceasing something writes one row to
 * the vault's RETIRED.md (what stopped, when, by whom, why, what replaces it, how to bring it
 * back) and commits it. With no vault the row goes to `<data dir>/RETIRED.md`.
 */

import fs from 'fs';
import path from 'path';
import { gitOrThrow, hasUpstream, git, repoTop } from './git.ts';
import { dataDir, readConfig } from './state.ts';

export interface RetireInput { thing: string; successor: string; why: string; by?: string; back?: string; vault?: string }
export interface RetireResult { file: string; row: string; committed: boolean; pushed: boolean }

const HEADER = `# RETIRED

Things that ceased, by hand (arise · stand · cease). Nothing here was deleted: each row says
where it went and how to bring it back.

| when | thing | why | successor | how to bring back | by |
|---|---|---|---|---|---|
`;

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '-';

export function retiredFile(vault?: string): string {
  const config = readConfig();
  const clean = vault?.replace(/^hub:/, '');
  const ref = config?.vaults.find((v) => !clean || v.name === clean)
    ?? (config?.hub?.vault ? { name: 'hub', path: config.hub.vault } : undefined);
  return path.join(ref?.path ?? dataDir(), 'RETIRED.md');
}

export function retire(input: RetireInput): RetireResult {
  if (!input.thing.trim()) throw new Error('retire needs the thing that ceases');
  if (!input.successor.trim()) throw new Error('retire needs --successor <x|nothing>');
  if (!input.why.trim()) throw new Error('retire needs --why "..."');
  const file = retiredFile(input.vault);
  const by = input.by ?? readConfig()?.name ?? 'arra';
  const row = `| ${new Date().toISOString()} | ${cell(input.thing)} | ${cell(input.why)} | ${cell(input.successor)} | ${cell(input.back ?? 'see git history / successor')} | ${cell(by)} |`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : HEADER;
  fs.writeFileSync(file, `${current}${current.endsWith('\n') ? '' : '\n'}${row}\n`);
  const top = repoTop(path.dirname(file));
  if (!top) return { file, row, committed: false, pushed: false };
  gitOrThrow(top, ['add', '--', path.relative(top, file)]);
  gitOrThrow(top, ['commit', '-q', '-m', `retire: ${input.thing.slice(0, 60)}`, '-m', `why: ${input.why}\nsuccessor: ${input.successor}`]);
  const pushed = hasUpstream(top) && git(top, ['push', '-q']).ok;
  return { file, row, committed: true, pushed };
}
