import type { HTTPAdapter } from '@x402/core/server';

export type ElysiaRequestLike = {
  request: Request;
  headers: Record<string, string | undefined>;
  path: string;
  query: Record<string, string | undefined>;
};

/** Adapts an Elysia request context to the framework-agnostic x402 HTTPAdapter interface. */
export class ElysiaAdapter implements HTTPAdapter {
  constructor(private ctx: ElysiaRequestLike) {}

  getHeader(name: string): string | undefined {
    return this.ctx.headers[name.toLowerCase()];
  }

  getMethod(): string {
    return this.ctx.request.method;
  }

  getPath(): string {
    return this.ctx.path;
  }

  getUrl(): string {
    return this.ctx.request.url;
  }

  getAcceptHeader(): string {
    return this.ctx.headers.accept ?? '';
  }

  getUserAgent(): string {
    return this.ctx.headers['user-agent'] ?? '';
  }

  getQueryParams(): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(this.ctx.query)) {
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  getQueryParam(name: string): string | string[] | undefined {
    return this.ctx.query[name];
  }
}
