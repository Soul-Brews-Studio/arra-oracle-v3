export function parseMenuIdParam(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) ? id : null;
}

export function isMenuId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
