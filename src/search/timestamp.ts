export function isoTimestamp(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const ms = timestampMs(value);
  if (ms === null || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestampMs(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = value.trim();
  if (!text) return null;
  const ms = /^\d+$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}
