export type PcaProjection = {
  projected: { x: number; y: number; z: number }[];
  varianceExplained: number[];
};

function covTimesVec(samples: Float64Array[], d: number, vec: Float64Array): Float64Array {
  const projections = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let dot = 0;
    for (let j = 0; j < d; j++) dot += samples[i][j] * vec[j];
    projections[i] = dot;
  }
  const result = new Float64Array(d);
  for (let i = 0; i < samples.length; i++) {
    for (let j = 0; j < d; j++) result[j] += samples[i][j] * projections[i];
  }
  for (let j = 0; j < d; j++) result[j] /= samples.length;
  return result;
}

function normalizeProjection(projected: { x: number; y: number; z: number }[]): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const point of projected) {
    if (point.x < minX) minX = point.x; if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y; if (point.y > maxY) maxY = point.y;
    if (point.z < minZ) minZ = point.z; if (point.z > maxZ) maxZ = point.z;
  }
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1, rangeZ = maxZ - minZ || 1;
  for (const point of projected) {
    point.x = ((point.x - minX) / rangeX) * 2 - 1;
    point.y = ((point.y - minY) / rangeY) * 2 - 1;
    point.z = ((point.z - minZ) / rangeZ) * 2 - 1;
  }
}

export function projectPca(vectors: number[][]): PcaProjection {
  const nFiles = vectors.length;
  const d = vectors[0].length;
  const mean = new Float64Array(d);
  for (const vector of vectors) for (let j = 0; j < d; j++) mean[j] += vector[j];
  for (let j = 0; j < d; j++) mean[j] /= nFiles;
  const centered = vectors.map((vector) => Float64Array.from(vector, (value, i) => value - mean[i]));
  const sampleSize = Math.min(nFiles, 5000);
  const samples = nFiles <= sampleSize
    ? centered
    : Array.from({ length: sampleSize }, (_, i) => centered[Math.floor(i * nFiles / sampleSize)]);
  const components: Float64Array[] = [];
  const eigenvalues: number[] = [];

  for (let comp = 0; comp < 3; comp++) {
    let v = Float64Array.from({ length: d }, (_, j) => Math.sin((comp + 1) * (j + 1) * 0.1));
    for (let iter = 0; iter < 50; iter++) {
      const cv = covTimesVec(samples, d, v);
      for (let prev = 0; prev < comp; prev++) {
        const pc = components[prev];
        let dot = 0;
        for (let j = 0; j < d; j++) dot += cv[j] * pc[j];
        for (let j = 0; j < d; j++) cv[j] -= dot * pc[j];
      }
      const norm = Math.sqrt(cv.reduce((sum, value) => sum + value * value, 0));
      if (norm < 1e-12) break;
      v = Float64Array.from(cv, (value) => value / norm);
    }
    const cv = covTimesVec(samples, d, v);
    eigenvalues.push(v.reduce((sum, value, j) => sum + value * cv[j], 0));
    components.push(v);
  }

  const totalVariance = eigenvalues.reduce((a, b) => a + b, 0) || 1;
  const projected = centered.map((vector) => ({
    x: vector.reduce((sum, value, j) => sum + value * components[0][j], 0),
    y: vector.reduce((sum, value, j) => sum + value * components[1][j], 0),
    z: vector.reduce((sum, value, j) => sum + value * components[2][j], 0),
  }));
  normalizeProjection(projected);
  return { projected, varianceExplained: eigenvalues.map((value) => +(value / totalVariance).toFixed(4)) };
}
