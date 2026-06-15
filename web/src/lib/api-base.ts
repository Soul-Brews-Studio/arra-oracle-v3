const STORAGE_KEY = "NEO_ARRA_API";
const TOKEN_KEY = "NEO_ARRA_TOKEN";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveApiBase(): string {
  const envUrl = import.meta.env.PUBLIC_BACKEND_URL?.trim();
  if (envUrl) return trimSlash(envUrl);
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  const queryUrl = params.get("api")?.trim();
  if (queryUrl) {
    const normalized = trimSlash(queryUrl);
    window.localStorage.setItem(STORAGE_KEY, normalized);
    return normalized;
  }

  return trimSlash(window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "");
}

export function apiUrl(path: string): string {
  const base = resolveApiBase();
  const rooted = path.startsWith("/") ? path : `/${path}`;
  return `${base}${rooted}`;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (typeof window !== "undefined" && !headers.has("Authorization")) {
    const token = window.localStorage.getItem(TOKEN_KEY)?.trim();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(apiUrl(path), { ...init, headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new ApiError(response.status, `${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return response.json() as Promise<T>;
}
