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
  const classNames = new Set<string>();
  const style = { colorScheme: '', cssText: '' } as Record<string, unknown>;
  style.setProperty = (key: string, value: string) => {
    style[key] = value;
    style.cssText = `${String(style.cssText)} ${key}: ${value};`.trim();
  };
  style.removeProperty = (key: string) => {
    delete style[key];
    style.cssText = String(style.cssText).replace(new RegExp(`${key}: [^;]+;?\\s*`, 'g'), '');
  };
  const documentElement = {
    classList: {
      add: (name: string) => { classNames.add(name); },
      contains: (name: string) => classNames.has(name),
      remove: (name: string) => { classNames.delete(name); },
      toggle: (name: string, force?: boolean) => {
        const shouldAdd = force ?? !classNames.has(name);
        if (shouldAdd) classNames.add(name);
        else classNames.delete(name);
        return shouldAdd;
      },
    },
    dataset: {} as Record<string, string>,
    style,
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
