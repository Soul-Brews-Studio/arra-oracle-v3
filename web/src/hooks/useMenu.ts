import { useCallback, useEffect, useState } from "react";
import type { MenuItem as HookMenuItem } from "hook-menu/model";

export interface MenuItem extends HookMenuItem {
  id?: string;
  parentId?: string | null;
  sourceName?: string;
  added?: boolean;
  hidden?: boolean;
  scope?: "main" | "sub" | "both";
  query?: Record<string, string>;
}

export interface MenuResponse {
  items: MenuItem[];
}

export interface UseMenuOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  host?: string;
  scope?: "main" | "sub" | "both";
  initialItems?: MenuItem[];
}

export interface UseMenuResult {
  items: MenuItem[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

function menuUrl(baseUrl = "", host?: string, scope?: UseMenuOptions["scope"]): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const url = `${trimmedBase}/api/menu`;
  const params = new URLSearchParams();
  if (host) params.set("host", host);
  if (scope) params.set("scope", scope);
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export function normalizeMenuResponse(payload: unknown): MenuItem[] {
  if (Array.isArray(payload)) return payload as MenuItem[];
  if (payload && typeof payload === "object" && Array.isArray((payload as MenuResponse).items)) {
    return (payload as MenuResponse).items;
  }
  return [];
}

export async function fetchMenuItems(options: UseMenuOptions = {}): Promise<MenuItem[]> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(menuUrl(options.baseUrl, options.host, options.scope));
  if (!response.ok) throw new Error(`Menu request failed ${response.status}: ${await response.text()}`);
  return normalizeMenuResponse(await response.json());
}

export function useMenu(options: UseMenuOptions = {}): UseMenuResult {
  const [items, setItems] = useState<MenuItem[]>(options.initialItems ?? []);
  const [loading, setLoading] = useState(!options.initialItems);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchMenuItems(options));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [options.baseUrl, options.fetcher, options.host, options.scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, error, reload };
}
