import fs from 'fs';
import { execFileSync } from 'child_process';

let cachedHasAvx: boolean | undefined;
let loggedDisable = false;

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
  loggedDisable = false;
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

export function logLocalVectorDisabled(reason: string): void {
  if (loggedDisable) return;
  loggedDisable = true;
  console.warn(`[Vector] Local vector search disabled: ${reason}. Falling back to FTS5-only results.`);
}
