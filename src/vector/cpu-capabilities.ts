import fs from 'fs';
import { execFileSync } from 'child_process';
import { LANCEDB_DIR, VECTORS_DB_PATH } from '../config.ts';

let cachedHasAvx: boolean | undefined;
// Last disabled-reason we logged. Tracks CURRENT state so the warning fires on
// a state transition (new/changed reason) instead of latching once-forever.
let lastDisableReason: string | undefined;

function truthy(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function detectCpuFlags(): string {
  if (process.env.ARRA_CPU_FLAGS !== undefined) return process.env.ARRA_CPU_FLAGS;
  if (process.platform === 'linux') {
    try { return fs.readFileSync('/proc/cpuinfo', 'utf-8'); } catch {}
  }
  if (process.platform === 'darwin') {
    try { return execFileSync('/usr/sbin/sysctl', ['-n', 'machdep.cpu.features'], { encoding: 'utf-8' }); } catch {}
    try { return execFileSync('/usr/sbin/sysctl', ['-n', 'machdep.cpu.leaf7_features'], { encoding: 'utf-8' }); } catch {}
  }
  return '';
}

export function resetCpuCapabilityCacheForTests(): void {
  cachedHasAvx = undefined;
  lastDisableReason = undefined;
}

export function hasAvx(): boolean {
  const forced = truthy(process.env.ARRA_FORCE_AVX);
  if (forced !== undefined) return forced;
  if (cachedHasAvx !== undefined) return cachedHasAvx;
  const flags = detectCpuFlags().toLowerCase();
  // AVX2 implies AVX on normal CPUs, but check both for explicitness.
  cachedHasAvx = /(^|[\s:])avx([\s_]|$)/.test(flags) || /(^|[\s:])avx2([\s_]|$)/.test(flags);
  return cachedHasAvx;
}

export function localNativeVectorDisabledReason(adapter: string | undefined = process.env.ORACLE_VECTOR_DB || 'lancedb'): string | undefined {
  const disabled = truthy(process.env.ORACLE_DISABLE_LOCAL_VECTOR);
  if (disabled === true) return 'ORACLE_DISABLE_LOCAL_VECTOR is enabled';
  if (disabled === false) return undefined;

  const nativeAdapters = new Set(['lancedb', 'sqlite-vec']);
  const forcedAvx = truthy(process.env.ARRA_FORCE_AVX);
  const needsX64AvxGate = forcedAvx === false || (process.arch === 'x64' && ['linux', 'win32'].includes(process.platform));
  if (adapter && nativeAdapters.has(adapter) && needsX64AvxGate && !hasAvx()) {
    return `CPU lacks AVX required by local native vector adapter (${adapter})`;
  }
  return undefined;
}

export interface LocalVectorIndexConfig {
  type?: string;
  dataPath?: string;
  collectionName?: string;
}

export function localVectorIndexMissingReason(config: LocalVectorIndexConfig): string | undefined {
  const type = config.type || process.env.ORACLE_VECTOR_DB || 'lancedb';
  if (type === 'lancedb') {
    // Mirror createVectorStore's default chain (factory.ts) so a preset that
    // omits dataPath can't false-positive "directory is missing".
    const dataPath = config.dataPath || process.env.ORACLE_VECTOR_DB_PATH || LANCEDB_DIR;
    const collectionName = config.collectionName;
    if (!dataPath || !fs.existsSync(dataPath)) return 'local LanceDB directory is missing';
    if (collectionName && !fs.existsSync(`${dataPath}/${collectionName}.lance`)) {
      return `local LanceDB collection is missing (${collectionName})`;
    }
  }
  if (type === 'sqlite-vec') {
    // Mirror createVectorStore's default chain (factory.ts).
    const dataPath = config.dataPath || process.env.ORACLE_VECTOR_DB_PATH || VECTORS_DB_PATH;
    if (!dataPath || !fs.existsSync(dataPath)) return 'local sqlite-vec database is missing';
  }
  return undefined;
}

export function logLocalVectorDisabled(reason: string): void {
  // Log only on a state transition (first time, or the reason changed). The
  // same reason is not re-logged (no spam); a *different* reason logs afresh.
  if (reason === lastDisableReason) return;
  lastDisableReason = reason;
  console.warn(`[Vector] Local vector search disabled: ${reason}. Falling back to FTS5-only results.`);
}

/**
 * Re-arm the disabled-warning latch once vectors are available again.
 * Call when the native gate passes (vectors recovered) so a later genuine
 * disable logs afresh instead of being suppressed by a stale latch — i.e. the
 * warning reflects CURRENT state, not a transient miss from earlier in the run.
 */
export function noteLocalVectorEnabled(): void {
  lastDisableReason = undefined;
}
