export type OracleV2Record = Record<string, unknown>;
export type OracleV2Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type OracleV2Headers = Record<string, string> | [string, string][] | Headers;

export interface OracleV2ClientOptions {
  baseUrl: string | URL;
  fetch?: OracleV2Fetch;
  headers?: OracleV2Headers;
  timeoutMs?: number;
}

export interface OracleV2Collection extends OracleV2Record {
  name: string;
  count?: number;
  rowCount?: number;
  documentCount?: number;
  estimatedBytes?: number;
}

export interface OracleV2Document extends OracleV2Record {
  id?: string;
  collection?: string;
  title?: string;
  content?: string;
  document?: string;
  source?: string;
  source_file?: string;
  metadata?: OracleV2Record;
}

export interface OracleV2CollectionsResponse {
  collections: OracleV2Collection[];
  raw: unknown;
}

export interface OracleV2DocumentsResponse {
  collection: string;
  documents: OracleV2Document[];
  raw: unknown;
}

export class OracleV2ClientError extends Error {
  readonly status?: number;
  readonly url?: string;
  readonly body?: string;

  constructor(message: string, options: { status?: number; url?: string; body?: string } = {}) {
    super(message);
    this.name = 'OracleV2ClientError';
    this.status = options.status;
    this.url = options.url;
    this.body = options.body;
  }
}

export class OracleV2Client {
  private readonly baseUrl: string;
  private readonly fetchImpl: OracleV2Fetch;
  private readonly headers?: OracleV2Headers;
  private readonly timeoutMs?: number;

  constructor(options: OracleV2ClientOptions) {
    const base = String(options.baseUrl).trim();
    if (!base) throw new OracleV2ClientError('Oracle v2 baseUrl is required');
    this.baseUrl = base.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers;
    this.timeoutMs = options.timeoutMs;
  }

  async fetchCollections(): Promise<OracleV2CollectionsResponse> {
    const raw = await this.getJson('/api/collections');
    return { collections: normalizeCollections(raw), raw };
  }

  async listCollections(): Promise<OracleV2Collection[]> {
    return (await this.fetchCollections()).collections;
  }

  async fetchDocuments(collection: string): Promise<OracleV2DocumentsResponse> {
    const name = collection.trim();
    if (!name) throw new OracleV2ClientError('collection is required');
    const raw = await this.getJson(`/api/documents?collection=${encodeURIComponent(name)}`);
    return { collection: name, documents: normalizeDocuments(raw, name), raw };
  }

  async listDocuments(collection: string): Promise<OracleV2Document[]> {
    return (await this.fetchDocuments(collection)).documents;
  }

  private async getJson(path: string): Promise<unknown> {
    const url = this.url(path);
    const controller = this.timeoutMs ? new AbortController() : undefined;
    const timeout = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...headersObject(this.headers) },
        signal: controller?.signal,
      });
      if (!response.ok) await throwHttpError(response, url);
      return await response.json();
    } catch (error) {
      if (error instanceof OracleV2ClientError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new OracleV2ClientError(`Oracle v2 request failed: ${message}`, { url });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private url(path: string): string {
    const apiPath = path.startsWith('/') ? path : `/${path}`;
    const baseUrl = new URL(this.baseUrl);
    const base = baseUrl.pathname.replace(/\/+$/, '');
    const suffix = apiPath.startsWith('/api/') && base.endsWith('/api') ? apiPath.slice(4) : apiPath;
    const queryIndex = suffix.indexOf('?');
    const pathname = queryIndex >= 0 ? suffix.slice(0, queryIndex) : suffix;
    const search = queryIndex >= 0 ? suffix.slice(queryIndex) : '';
    baseUrl.hash = '';
    baseUrl.search = search;
    baseUrl.pathname = `${base}${pathname}`;
    return baseUrl.toString();
  }
}

export function createOracleV2Client(options: OracleV2ClientOptions): OracleV2Client {
  return new OracleV2Client(options);
}

function normalizeCollections(payload: unknown): OracleV2Collection[] {
  return payloadArray(payload, ['collections', 'items', 'data']).map((item, index) => {
    if (typeof item === 'string') return { name: item };
    const record = objectRecord(item, `collections[${index}]`);
    const name = record.name ?? record.collection ?? record.key ?? record.id;
    if (typeof name !== 'string' || !name.trim()) {
      throw new OracleV2ClientError(`collections[${index}] is missing a name`);
    }
    return { ...record, name: name.trim() } as OracleV2Collection;
  });
}

function normalizeDocuments(payload: unknown, collection: string): OracleV2Document[] {
  return payloadArray(payload, ['documents', 'items', 'rows', 'data']).map((item, index) => {
    if (typeof item === 'string') return { collection, content: item };
    const record = objectRecord(item, `documents[${index}]`);
    return { collection, ...record } as OracleV2Document;
  });
}

function payloadArray(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) {
    for (const key of keys) {
      const value = payload[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new OracleV2ClientError(`Oracle v2 response did not include ${keys.join(' or ')}`);
}

function objectRecord(value: unknown, label: string): OracleV2Record {
  if (isRecord(value)) return value;
  throw new OracleV2ClientError(`${label} must be an object`);
}

function isRecord(value: unknown): value is OracleV2Record {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function headersObject(headers?: OracleV2Headers): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

async function throwHttpError(response: Response, url: string): Promise<never> {
  const body = (await response.text().catch(() => '')).slice(0, 500);
  throw new OracleV2ClientError(
    `Oracle v2 request failed with HTTP ${response.status}`,
    { status: response.status, url, body },
  );
}
