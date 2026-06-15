import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

export function htmlFor(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

export function installBrowserLocation(path = '/menu') {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const url = new URL(path, 'http://localhost');
  const localStorage = new Map<string, string>();
  const documentElement = {
    classList: { toggle() {} },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const windowStub = {
    location: { origin: url.origin, href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { state: null, pushState() {}, replaceState() {} },
    localStorage: {
      getItem: (key: string) => localStorage.get(key) ?? null,
      setItem: (key: string, value: string) => localStorage.set(key, value),
    },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = windowStub as unknown as Window & typeof globalThis;
  globalThis.document = { defaultView: windowStub, documentElement } as unknown as Document;
  return () => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  };
}
