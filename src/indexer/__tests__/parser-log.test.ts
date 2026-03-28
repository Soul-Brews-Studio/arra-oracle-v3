/**
 * Tests for parseLogFile() — snapshot/log document parser
 *
 * Covers:
 * - Frontmatter extraction (project, tags, type)
 * - Path-based project inference from ψ/memory/logs/{project}/
 * - Section splitting by ## headers
 * - Fallback to whole-file when no sections produce content
 * - Thai + mixed language content
 * - Files without frontmatter
 * - Short section filtering (< 30 chars body)
 * - Type is always 'snapshot'
 * - ID uniqueness within a file
 */

import { describe, it, expect } from 'bun:test';
import { parseLogFile } from '../parser.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_WITH_FRONTMATTER = `---
type: snapshot
project: mmv-tarots
tags: [auth, jwt, milestone]
date: 2025-12-20
agent: oracle-keeper
---

# Snapshot: MMV Tarots Auth Milestone

**Time**: 2025-12-20 14:50

## Context

Working on JWT authentication for the mmv-tarots prediction API. Integrated middleware and tested against /api/predict endpoint.

## Decisions

- Use RS256 for JWT signing
- Refresh tokens stored in httpOnly cookie
- Access token TTL: 15 minutes

## Next Actions

- Add rate limiting middleware
- Wire up logout endpoint
`;

const SNAPSHOT_WITHOUT_FRONTMATTER = `# Snapshot: Pro AI Sheet Deep Dive

**Project**: pro-ai-sheet
**Tech Stack**: Next.js 16, React 19, TypeScript, TailwindCSS v4, KaTeX.

## Core Architecture

The application is a Single Page Application built with Next.js App Router, primarily relying on client-side logic with use client directive throughout.

## Key Modules

EquationConverter.tsx handles paste events and conversion pipeline. MathRenderer.tsx renders final LaTeX output.
`;

const SNAPSHOT_THAI_CONTENT = `---
project: jaothui-dashboard
tags: [thai, dashboard, api]
---

# Snapshot: Jaothui Dashboard Context

## Context

มนุษย์ต้องการโฟกัสที่โปรเจกต์ jaothui-dashboard เพื่อเรียนรู้โครงสร้างและแนวทางการ implementation ต่อเนื่องภายใต้ Oracle Framework ระบบใช้ React และ FastAPI

## Decisions

- เริ่มต้น session ด้วยการ sync focus.md และ date อัพเดท
- จะดำเนินการศึกษาโค้ดในส่วนของ dashboard components อย่างละเอียด
`;

const SNAPSHOT_NO_SECTIONS = `---
project: simple-eq
tags: [audio, eq]
---

# Snapshot: Simple EQ Setup

This is a minimal snapshot with no sections, just a brief note about the EQ configuration done today.
`;

const SNAPSHOT_SHORT_SECTIONS = `# Snapshot: Minimal

## Context

ok

## Evidence

Commit: abc123. Changed files: src/main.ts. Verified all tests pass with the new configuration.

## Tags

short
`;

const SNAPSHOT_PLAN_TYPE = `---
type: plan
project: oracle-framework
task_id: "#phase-3"
tags: [plan, rrr, friction]
---

# Plan: RRR Phase 3 Implementation

## Overview

Implement two-pass friction scan in the rrr skill to provide deterministic friction accounting before and after drafting retrospectives. This is Phase 3 of the broader RRR enhancement initiative.

## Steps

1. Update SKILL.md with two-pass integration
2. Add run-two-pass-friction-scan.sh script
3. Write regression tests
4. Verify PASS on all smoke tests
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseLogFile — type is always snapshot', () => {
  it('produces documents with type "snapshot"', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth.md', SNAPSHOT_WITH_FRONTMATTER);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(doc.type).toBe('snapshot');
    }
  });

  it('assigns snapshot type even for type:plan files', () => {
    const docs = parseLogFile('ψ/memory/logs/oracle-framework/2026-03-12_plan.md', SNAPSHOT_PLAN_TYPE);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(doc.type).toBe('snapshot');
    }
  });
});

describe('parseLogFile — project extraction', () => {
  it('uses frontmatter project field when present', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth.md', SNAPSHOT_WITH_FRONTMATTER);
    expect(docs.length).toBeGreaterThan(0);
    // frontmatter says project: mmv-tarots
    expect(docs[0].project).toBe('mmv-tarots');
  });

  it('falls back to path-based project when no frontmatter project', () => {
    const docs = parseLogFile('ψ/memory/logs/pro-ai-sheet/2026-01-15_deep-dive.md', SNAPSHOT_WITHOUT_FRONTMATTER);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].project).toBe('pro-ai-sheet');
  });

  it('infers project slug from direct parent folder under logs/', () => {
    const docs = parseLogFile('ψ/memory/logs/oracle-ranger/2025-12-18_setup.md', SNAPSHOT_NO_SECTIONS);
    // No frontmatter project field → infer from path → oracle-ranger
    // (SNAPSHOT_NO_SECTIONS has frontmatter project: simple-eq, so use a plain string for this test)
    const plainContent = `# Snapshot: Oracle Ranger Setup\n\n## Context\n\nSetting up oracle-ranger with initial configuration and testing the first deployment pipeline.\n`;
    const plainDocs = parseLogFile('ψ/memory/logs/oracle-ranger/2025-12-18_setup.md', plainContent);
    expect(plainDocs.length).toBeGreaterThan(0);
    expect(plainDocs[0].project).toBe('oracle-ranger');
  });

  it('returns undefined project when path has no recognizable project slug', () => {
    const docs = parseLogFile('some/random/path/file.md', `# Snapshot: No Project\n\n## Section\n\nContent here without any project information attached.\n`);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].project).toBeUndefined();
  });
});

describe('parseLogFile — section splitting', () => {
  it('splits content by ## headers into separate documents', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth.md', SNAPSHOT_WITH_FRONTMATTER);
    // Should have Context, Decisions, Next Actions sections (preamble before first ## is skipped)
    expect(docs.length).toBe(3);
  });

  it('each document content contains the file title prefix', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth.md', SNAPSHOT_WITH_FRONTMATTER);
    for (const doc of docs) {
      expect(doc.content).toContain('Snapshot: MMV Tarots Auth Milestone');
    }
  });

  it('each document content contains the section title', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth.md', SNAPSHOT_WITH_FRONTMATTER);
    const titles = docs.map(d => d.content);
    expect(titles.some(t => t.includes('Context'))).toBe(true);
    expect(titles.some(t => t.includes('Decisions'))).toBe(true);
    expect(titles.some(t => t.includes('Next Actions'))).toBe(true);
  });

  it('works with files that have no frontmatter', () => {
    const docs = parseLogFile('ψ/memory/logs/pro-ai-sheet/2026-01-15_deep-dive.md', SNAPSHOT_WITHOUT_FRONTMATTER);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.some(d => d.content.includes('Core Architecture'))).toBe(true);
  });
});

describe('parseLogFile — fallback to whole-file document', () => {
  it('produces one document when no ## sections have enough content', () => {
    const docs = parseLogFile('ψ/memory/logs/simple-eq/2026-01-10_note.md', SNAPSHOT_NO_SECTIONS);
    // No ## sections in this file, should fall back to single doc
    expect(docs.length).toBe(1);
    expect(docs[0].id).toBe('snapshot_2026-01-10_note');
  });

  it('fallback document has type snapshot', () => {
    const docs = parseLogFile('ψ/memory/logs/simple-eq/2026-01-10_note.md', SNAPSHOT_NO_SECTIONS);
    expect(docs[0].type).toBe('snapshot');
  });
});

describe('parseLogFile — short section filtering', () => {
  it('skips sections with body shorter than 30 characters', () => {
    const docs = parseLogFile('ψ/memory/logs/oracle/2026-01-01_minimal.md', SNAPSHOT_SHORT_SECTIONS);
    // "Context" section body is "ok" (2 chars) → skipped
    // "Evidence" section body is long → kept
    // "Tags" body is "short" (5 chars) → skipped
    expect(docs.length).toBe(1);
    expect(docs[0].content).toContain('Evidence');
  });
});

describe('parseLogFile — tags / concepts', () => {
  it('extracts frontmatter tags as concepts', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth.md', SNAPSHOT_WITH_FRONTMATTER);
    expect(docs.length).toBeGreaterThan(0);
    // Tags from frontmatter: auth, jwt, milestone
    expect(docs[0].concepts).toContain('auth');
    expect(docs[0].concepts).toContain('jwt');
    expect(docs[0].concepts).toContain('milestone');
  });

  it('still produces concepts without frontmatter tags', () => {
    const docs = parseLogFile('ψ/memory/logs/pro-ai-sheet/2026-01-15.md', SNAPSHOT_WITHOUT_FRONTMATTER);
    expect(docs.length).toBeGreaterThan(0);
    // concepts array should at least exist (may be empty if no matching terms)
    expect(Array.isArray(docs[0].concepts)).toBe(true);
  });
});

describe('parseLogFile — Thai content', () => {
  it('handles Thai language content without error', () => {
    const docs = parseLogFile('ψ/memory/logs/jaothui-dashboard/2025-12-20_context.md', SNAPSHOT_THAI_CONTENT);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].type).toBe('snapshot');
  });

  it('preserves Thai content in document body', () => {
    const docs = parseLogFile('ψ/memory/logs/jaothui-dashboard/2025-12-20_context.md', SNAPSHOT_THAI_CONTENT);
    const allContent = docs.map(d => d.content).join(' ');
    expect(allContent).toContain('jaothui-dashboard');
  });

  it('assigns correct project from frontmatter on Thai file', () => {
    const docs = parseLogFile('ψ/memory/logs/jaothui-dashboard/2025-12-20_context.md', SNAPSHOT_THAI_CONTENT);
    expect(docs[0].project).toBe('jaothui-dashboard');
  });
});

describe('parseLogFile — ID uniqueness', () => {
  it('generates unique IDs for each section in a file', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth.md', SNAPSHOT_WITH_FRONTMATTER);
    const ids = docs.map(d => d.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('IDs are based on filename slug', () => {
    const docs = parseLogFile('ψ/memory/logs/mmv-tarots/2025-12-20_auth-milestone.md', SNAPSHOT_WITH_FRONTMATTER);
    for (const doc of docs) {
      expect(doc.id).toContain('2025-12-20_auth-milestone');
    }
  });
});

describe('parseLogFile — source_file', () => {
  it('stores the relative path as source_file', () => {
    const relPath = 'ψ/memory/logs/oracle/2025-12-18_setup.md';
    const docs = parseLogFile(relPath, SNAPSHOT_WITH_FRONTMATTER);
    for (const doc of docs) {
      expect(doc.source_file).toBe(relPath);
    }
  });
});

describe('parseLogFile — timestamps', () => {
  it('sets created_at and updated_at as numbers', () => {
    const before = Date.now();
    const docs = parseLogFile('ψ/memory/logs/oracle/2025-12-18_setup.md', SNAPSHOT_WITH_FRONTMATTER);
    const after = Date.now();
    for (const doc of docs) {
      expect(typeof doc.created_at).toBe('number');
      expect(typeof doc.updated_at).toBe('number');
      expect(doc.created_at).toBeGreaterThanOrEqual(before);
      expect(doc.created_at).toBeLessThanOrEqual(after);
    }
  });
});
