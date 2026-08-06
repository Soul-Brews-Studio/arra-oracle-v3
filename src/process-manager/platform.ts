export function getPlatformTimeout(baseMs: number): number {
  const WINDOWS_MULTIPLIER = 2.0;
  const safeBase = Number.isFinite(baseMs) && baseMs >= 0 ? baseMs : 0;
  return process.platform === 'win32' ? Math.round(safeBase * WINDOWS_MULTIPLIER) : safeBase;
}
