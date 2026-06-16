export function sessionApiBase(): string {
  const raw = process.env.ORACLE_API ?? "http://localhost:47778";
  return raw.replace(/\/$/, "");
}

export async function sessionFetch(path: string, opts?: RequestInit): Promise<Response> {
  const url = `${sessionApiBase()}${path}`;
  try {
    return await fetch(url, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot reach ARRA Oracle at ${sessionApiBase()}\n` +
      `  → Is the server running? Try: bun run server  (in arra-oracle-v3 repo)\n` +
      `  → Override with ORACLE_API=http://localhost:<port>\n` +
      `  Original: ${msg}`,
    );
  }
}
