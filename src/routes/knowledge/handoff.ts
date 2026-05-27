/**
 * POST /api/handoff — write a handoff markdown file under ψ/inbox/handoff.
 */

import { Elysia } from 'elysia';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { HandoffBody } from './model.ts';

export const handoffEndpoint = new Elysia().post(
  '/handoff',
  ({ body, set }) => {
    try {
      const data = (body ?? {}) as Record<string, any>;
      if (!data.content) {
        set.status = 400;
        return { error: 'Missing required field: content' };
      }

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

      const slug = data.slug || data.content
        .substring(0, 50)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'handoff';

      const filename = `${dateStr}_${timeStr}_${slug}.md`;
      const dirPath = path.join(REPO_ROOT, 'ψ/inbox/handoff');
      const filePath = path.join(dirPath, filename);

      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, data.content, 'utf-8');

      set.status = 201;
      return {
        success: true,
        file: `ψ/inbox/handoff/${filename}`,
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
