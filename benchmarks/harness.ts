import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface BenchOptions {
  iterations?: number;
  warmup?: number;
}

export type BenchFn = () => unknown | Promise<unknown>;

const fromEnv = (fallback: number) => {
  const raw = process.env.BENCH_ITERATIONS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export async function runBench(name: string, fn: BenchFn, options: BenchOptions = {}) {
  const iterations = fromEnv(options.iterations ?? 200);
  const warmup = options.warmup ?? Math.min(20, Math.max(1, Math.floor(iterations / 10)));

  for (let i = 0; i < warmup; i += 1) await fn();

  const started = Bun.nanoseconds();
  for (let i = 0; i < iterations; i += 1) await fn();
  const elapsedNs = Bun.nanoseconds() - started;

  const avgUs = elapsedNs / iterations / 1_000;
  const totalMs = elapsedNs / 1_000_000;
  console.log(`${name}: ${iterations} iterations, ${avgUs.toFixed(2)} µs/op, ${totalMs.toFixed(2)} ms total`);
}

export function tempBenchDir(name: string) {
  return mkdtempSync(join(tmpdir(), `arra-bench-${name}-`));
}
