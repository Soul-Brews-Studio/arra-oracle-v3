const DEFAULT_RETRY_COUNT = 2;
const RETRIABLE_STATUSES = new Set([500, 502, 503, 504]);
export const UPSTREAM_RETRY_ATTEMPTS_HEADER = 'X-Upstream-Retry-Attempts';

type RetryAttempt = (attempt: number) => Promise<Response>;
type RetryableResponse = (response: Response) => boolean;

export type UpstreamRetryOptions = {
  maxRetries?: number;
  shouldRetryResponse?: RetryableResponse;
};

export function retryCountFromEnv(value = process.env.ARRA_RETRY_COUNT): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_RETRY_COUNT;
}

export function isRetryableUpstreamStatus(status: number): boolean {
  return RETRIABLE_STATUSES.has(status);
}

export async function retryableRequestBody(request: Request): Promise<ArrayBuffer | undefined> {
  return request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
}

export function cloneRetryableBody(body: ArrayBuffer | undefined): ArrayBuffer | undefined {
  return body ? body.slice(0) : undefined;
}

function responseWithRetryAttempts(response: Response, attempts: number): Response {
  const headers = new Headers(response.headers);
  headers.set(UPSTREAM_RETRY_ATTEMPTS_HEADER, String(attempts));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function discard(response: Response): Promise<void> {
  const cancelled = response.body?.cancel();
  if (cancelled) await cancelled.catch(() => undefined);
}

export async function retryUpstreamRequest(
  attempt: RetryAttempt,
  options: UpstreamRetryOptions = {},
): Promise<Response> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? retryCountFromEnv()));
  const shouldRetry = options.shouldRetryResponse ?? ((response) => isRetryableUpstreamStatus(response.status));
  async function run(current: number): Promise<Response> {
    try {
      const response = await attempt(current);
      if (current < maxRetries && shouldRetry(response)) {
        await discard(response);
        return run(current + 1);
      }
      return responseWithRetryAttempts(response, current);
    } catch (error) {
      if (current >= maxRetries) throw error;
      return run(current + 1);
    }
  }

  return run(0);
}
