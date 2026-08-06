export interface PluginInvokeResult {
  ok?: boolean;
  body?: unknown;
  output?: string;
  status?: number;
  headers?: unknown;
  error?: unknown;
}

function failureStatus(status: unknown): number {
  return Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599 ? Number(status) : 500;
}

export function pluginFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return typeof error === 'string' && error.trim().length > 0 ? error.trim() : 'plugin failed';
}

function responseHeaders(headers: unknown): Headers | undefined {
  if (headers instanceof Headers) return headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') continue;
    try {
      result.set(name, value);
    } catch {
      // Plugin-provided header names are untrusted; ignore invalid pairs.
    }
  }
  return result;
}

export function responseFromPluginResult(result: unknown): unknown {
  if (result instanceof Response) return result;
  const record = (result && typeof result === 'object') ? result as PluginInvokeResult : null;
  if (!record) return result ?? { ok: true };
  if (record.ok === false) {
    return Response.json(
      { ok: false, error: pluginFailureMessage(record.error) },
      { status: failureStatus(record.status), headers: responseHeaders(record.headers) },
    );
  }
  if (record.body !== undefined) return record.body;
  if (record.output !== undefined) return { ok: true, output: record.output };
  return record;
}

export function isPluginInvokeFailure(result: unknown): result is PluginInvokeResult & { ok: false } {
  return !!result && typeof result === 'object' && (result as PluginInvokeResult).ok === false;
}

export async function withPluginTimeout<T>(operation: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('handler timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
