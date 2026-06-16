const DEFAULT_API_BASE = 'http://localhost:47778';

export type Args = string[];
export type Flags = Record<string, string | boolean>;
export type ParsedArgs = { flags: Flags; positionals: string[] };

export function parseArgs(args: Args): ParsedArgs {
  const flags: Flags = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const raw = value.slice(2);
    const equals = raw.indexOf('=');
    const key = (equals >= 0 ? raw.slice(0, equals) : raw).replace(/-/g, '_');
    if (equals >= 0) flags[key] = raw.slice(equals + 1);
    else if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
    else flags[key] = true;
  }
  return { flags, positionals };
}

export function flag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name.replace(/-/g, '_')];
  if (value === undefined || value === false) return undefined;
  return value === true ? 'true' : String(value);
}

export function resolveApiBase(env: Record<string, string | undefined> = process.env): string {
  return (env.ARRA_API || env.ORACLE_API || DEFAULT_API_BASE).replace(/\/+$/, '');
}

export function authHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const token = env.ARRA_API_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function messageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (typeof record.message === 'string') return record.message;
  return fallback;
}

export async function requestText(path: string, init: RequestInit = {}): Promise<string> {
  const base = resolveApiBase();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { accept: '*/*', ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch (error) {
    throw new Error(`Cannot reach ARRA at ${base}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  if (response.ok) return text;
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  throw new Error(`${path} returned ${response.status}: ${messageFromPayload(payload, text || response.statusText)}`);
}

export async function requestJson<T>(path: string): Promise<T> {
  const text = await requestText(path, { headers: { accept: 'application/json' } });
  return (text ? JSON.parse(text) : {}) as T;
}
