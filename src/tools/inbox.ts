/**
 * Oracle Inbox Handler
 *
 * List and preview pending handoff files from the Oracle inbox.
 */

import path from 'path';
import fs from 'fs';
import type { ToolContext, ToolResponse, OracleInboxInput } from './types.ts';

export const inboxToolDef = {
  name: 'oracle_inbox',
  description: 'List and preview pending handoff files from the Oracle inbox. Returns files sorted newest-first with previews.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum files to return (default: 10)',
        default: 10
      },
      offset: {
        type: 'number',
        description: 'Number of files to skip (for pagination)',
        default: 0
      },
      type: {
        type: 'string',
        enum: ['handoff', 'all'],
        description: 'Filter by inbox type (default: all)',
        default: 'all'
      }
    }
  }
};

export async function handleInbox(ctx: ToolContext, input: OracleInboxInput): Promise<ToolResponse> {
  if (input == null || typeof input !== 'object') throw new Error('inbox input must be an object');
  const { limit = 10, offset = 0, type = 'all' } = input;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('limit must be between 1 and 100');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('offset must be >= 0');
  }
  if (!['all', 'handoff'].includes(type)) {
    throw new Error('Invalid inbox type: must be one of all, handoff');
  }
  const inboxDir = path.join(ctx.repoRoot, 'ψ/inbox');
  const results: Array<{ filename: string; path: string; created: string; preview: string; type: string }> = [];

  if (type === 'all' || type === 'handoff') {
    const handoffDir = path.join(inboxDir, 'handoff');
    if (fs.existsSync(handoffDir)) {
      const files = fs.readdirSync(handoffDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse();

      for (const file of files) {
        const filePath = path.join(handoffDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
        const created = dateMatch
          ? `${dateMatch[1]}T${dateMatch[2].replace('-', ':')}:00`
          : 'unknown';

        results.push({
          filename: file,
          path: `ψ/inbox/handoff/${file}`,
          created,
          preview: content.substring(0, 500),
          type: 'handoff',
        });
      }
    }
  }

  const total = results.length;
  const paginated = results.slice(offset, offset + limit);

  console.error(`[MCP:INBOX] ${total} files, returning ${paginated.length} (offset=${offset})`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ files: paginated, total, limit, offset }, null, 2)
    }]
  };
}
