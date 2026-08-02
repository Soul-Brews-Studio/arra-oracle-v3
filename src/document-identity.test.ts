import { describe, expect, test } from 'bun:test';
import {
  UNIVERSAL_PROJECT,
  canonicalProject,
  contentDigest,
  documentStorageId,
} from './document-identity.ts';

describe('document identity', () => {
  test('namespaces equal display IDs by verified project identity', () => {
    const displayId = 'learning_shared_0';
    const projectA = documentStorageId('github.com/acme/a', displayId);
    const projectB = documentStorageId('github.com/acme/b', displayId);

    expect(projectA).toStartWith('doc:');
    expect(projectA).not.toBe(projectB);
    expect(projectA).toBe(documentStorageId(' GITHUB.COM/ACME/A ', displayId));
  });

  test('uses the universal sentinel for missing projects', () => {
    expect(canonicalProject(null)).toBe(UNIVERSAL_PROJECT);
    expect(documentStorageId(null, 'principle_1')).toBe(
      documentStorageId(UNIVERSAL_PROJECT, 'principle_1'),
    );
  });

  test('maps only the verified current-vault alias', () => {
    const canonical = 'github.com/mengazaa/my-second-brain-v2';
    expect(canonicalProject('My Second Brain V2')).toBe(canonical);
    expect(documentStorageId('my second brain v2', 'lesson_1')).toBe(
      documentStorageId(canonical, 'lesson_1'),
    );
    expect(canonicalProject('my-second-brain-v2')).toBe('my-second-brain-v2');
    expect(canonicalProject('mengazaa/my-second-brain-v2')).toBe('mengazaa/my-second-brain-v2');
  });

  test('hashes full content deterministically', () => {
    expect(contentDigest('same')).toBe(contentDigest('same'));
    expect(contentDigest('same')).not.toBe(contentDigest('different'));
  });

  test('rejects an empty display ID', () => {
    expect(() => documentStorageId('github.com/acme/a', '')).toThrow('displayId is required');
  });
});
