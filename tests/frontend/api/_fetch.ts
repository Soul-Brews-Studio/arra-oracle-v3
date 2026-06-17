type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

export function requestPath(input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw, 'http://localhost');
  return `${url.pathname}${url.search}`;
}

export function installFetch(handler: FetchHandler) {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = requestPath(input);
    calls.push({ input: path, init });
    return Promise.resolve(handler(path, init));
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

export function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}
