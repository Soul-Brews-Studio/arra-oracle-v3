/**
 * POST /api/handoff — write a handoff markdown file under ψ/inbox/handoff.
 */

import { Elysia } from 'elysia';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { tenantDataPath } from '../../middleware/tenant.ts';
import { HandoffBody } from './model.ts';

const repoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;
const relativePath = (filePath: string) => path.relative(repoRoot(), filePath).split(path.sep).join('/');
const inboxDir = () => tenantDataPath(path.join(repoRoot(), 'ψ/inbox'));
const fallbackSlug = (content: string) => content.substring(0, 50);

function safeSlug(raw: unknown, content: string): string {
  const source = typeof raw === 'string' && raw.trim() ? raw : fallbackSlug(content);
  const slug = source
    .substring(0, 80)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'handoff';
}

function containedFile(dirPath: string, filename: string): string {
  const root = path.resolve(dirPath);
  const filePath = path.resolve(root, filename);
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid handoff path');
  return filePath;
}

export const handoffEndpoint = new Elysia().post(
  '/handoff',
  ({ body, set }) => {
    try {
      const data = (body ?? {}) as Record<string, any>;
      if (typeof data.content !== 'string' || !data.content.trim()) {
        set.status = 400;
        return { error: 'Missing required field: content' };
      }

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

      const slug = safeSlug(data.slug, data.content);

      const filename = `${dateStr}_${timeStr}_${slug}.md`;
      const dirPath = path.join(inboxDir(), 'handoff');
      const filePath = containedFile(dirPath, filename);

      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, data.content, 'utf-8');

      set.status = 201;
      return {
        success: true,
        file: relativePath(filePath),
        message: 'Handoff written.',
      };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },
  {
    body: HandoffBody,
    detail: {
      tags: ['knowledge'],
      menu: { group: 'hidden' },
      summary: 'Write a handoff markdown file',
    },
  },
);
