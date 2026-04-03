import * as THREE from 'three';

/** KlakMath: XXHash for deterministic random */
export function xxhash(seed: number, data: number): number {
  let h = ((seed + 374761393) >>> 0);
  h = ((h + (data * 3266489917 >>> 0)) >>> 0);
  h = ((((h << 17) | (h >>> 15)) * 668265263) >>> 0);
  h ^= h >>> 15;
  h = ((h * 2246822519) >>> 0);
  h ^= h >>> 13;
  h = ((h * 3266489917) >>> 0);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** KlakMath: Point on sphere */
export function hashOnSphere(seed: number, data: number): THREE.Vector3 {
  const phi = xxhash(seed, data) * Math.PI * 2;
  const cosTheta = xxhash(seed, data + 0x10000000) * 2 - 1;
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  return new THREE.Vector3(sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta);
}

/** Volume distribution: surface-biased but with real depth (range 0.2-1.0) */
export function hashInSphere(seed: number, data: number): THREE.Vector3 {
  const dir = hashOnSphere(seed, data);
  const raw = xxhash(seed + 77, data + 0x20000000);
  const r = 0.2 + 0.8 * raw * raw;
  return dir.multiplyScalar(r);
}

/** KlakMath: CdsTween spring */
export function cdsTween(
  state: { x: number; v: number },
  target: number,
  speed: number,
  dt: number
): { x: number; v: number } {
  const n1 = state.v - (state.x - target) * (speed * speed * dt);
  const n2 = 1 + speed * dt;
  const nv = n1 / (n2 * n2);
  return { x: state.x + nv * dt, v: nv };
}

/** 1D noise using xxhash */
export function noise1D(p: number, seed: number): number {
  const i = Math.floor(p);
  const f = p - i;
  const u = f * f * (3 - 2 * f);
  const g0 = xxhash(seed, i) * 2 - 1;
  const g1 = xxhash(seed, i + 1) * 2 - 1;
  return g0 * (1 - u) + g1 * u;
}

/** KlakMath: Fractal noise */
export function fractalNoise(p: number, octaves: number, seed: number): number {
  let f = 0, w = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    f += w * noise1D(p, seed + i);
    max += w;
    p *= 2;
    w *= 0.5;
  }
  return f / max;
}

/** Straight line between two points (used for lightning paths) */
export function createLightningPath(start: THREE.Vector3, end: THREE.Vector3, _segments = 8): THREE.Vector3[] {
  return [start.clone(), end.clone()];
}
