import { apiUrl } from './oracle';

export interface PluginStateResponse {
  ok: boolean;
  plugin: string;
  enabled: boolean;
  requiresRestart: boolean;
  message: string;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return fallback;
}

export async function setPluginEnabled(name: string, enabled: boolean): Promise<PluginStateResponse> {
  const path = `/api/plugins/${encodeURIComponent(name)}/state`;
  const response = await fetch(apiUrl(path), {
    method: 'PATCH',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${errorMessage(payload, response.statusText)}`);
  return payload as PluginStateResponse;
}
