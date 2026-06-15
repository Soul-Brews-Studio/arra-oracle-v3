import { describe, expect, test } from 'bun:test';
import { applyTheme } from '../../../frontend/src/theme';

function withoutDocument() {
  const previousDocument = globalThis.document;
  Reflect.deleteProperty(globalThis, 'document');
  return () => {
    globalThis.document = previousDocument;
  };
}

describe('applyTheme without document', () => {
  test('returns safely when no document element is available', () => {
    const restore = withoutDocument();
    try {
      expect(() => applyTheme('dark')).not.toThrow();
    } finally {
      restore();
    }
  });
});
