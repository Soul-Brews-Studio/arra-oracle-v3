import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

export function htmlFor(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

export function installBrowserLocation(path = '/menu') {
  const previousDocument = globalThis.document;
  const url = new URL(path, 'http://localhost');
  globalThis.document = {
    defaultView: {
      location: {
        origin: url.origin,
        href: url.href,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
      },
      history: { state: null, pushState() {}, replaceState() {} },
      addEventListener() {},
      removeEventListener() {},
    },
  } as unknown as Document;
  return () => {
    globalThis.document = previousDocument;
  };
}
