/**
 * POST /api/handoff — write a handoff markdown file under ψ/inbox/handoff.
 */

import { Elysia } from 'elysia';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { tenantDataPath } from '../../middleware/tenant.ts';
import { HandoffBody } from './model.ts';
import { relativeKnowledgePath, safeHandoffSlug, writeHandoffFile } from '../../knowledge/handoff.ts';

const repoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;
const inboxDir = () => tenantDataPath(path.join(repoRoot(), 'ψ/inbox'));
export const handoffEndpoint = new Elysia().post(
  '/handoff',
  ({ body, set }) => {
    try {
      const data = (body ?? {}) as Record<string, any>;
      if (typeof data.content !== 'string' || !data.content.trim()) {
        set.status = 400;
        return { error: 'Missing required field: content' };
      }

      const dirPath = path.join(inboxDir(), 'handoff');
      const filePath = writeHandoffFile(dirPath, data.content, safeHandoffSlug(data.slug, data.content));

      set.status = 201;
      return {
        success: true,
        file: relativeKnowledgePath(repoRoot(), filePath),
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
