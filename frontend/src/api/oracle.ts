export const TAURI_API_BASE = 'http://localhost:47778';
export const API_BASE = isTauri() ? TAURI_API_BASE : '';

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function apiUrl(path: string): string {
  return API_BASE ? new URL(path, API_BASE).toString() : path;
}
