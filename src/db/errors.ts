export function isMissingTableError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return /\bno such table\s*:/i.test(message);
}
