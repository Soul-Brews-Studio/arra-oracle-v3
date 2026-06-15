type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

export function installFetch(handler: FetchHandler) {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return Promise.resolve(handler(input, init));
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
