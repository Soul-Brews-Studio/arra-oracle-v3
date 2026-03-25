/**
 * Knowledge Routes — /api/learn, /api/handoff, /api/inbox
 */

import type { Hono } from 'hono';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../config.ts';
import { handleLearn } from '../server/handlers.ts';

export function registerKnowledgeRoutes(app: Hono) {
  // Learn
  app.post('/api/learn', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.pattern) {
        return c.json({ error: 'Missing required field: pattern' }, 400);
      }
      const result = handleLearn(
        data.pattern,
        data.source,
        data.concepts,
        data.origin,   // 'mother' | 'arthur' | 'volt' | 'human' (null = universal)
        data.project,  // ghq-style project path (null = universal)
        data.cwd       // Auto-detect project from cwd
      );
      return c.json(result);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  // Handoff
  app.post('/api/handoff', async (c) => {
    try {
      const data = await c.req.json();
      if (!data.content) {
        return c.json({ error: 'Missing required field: content' }, 400);
      }

      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

      // Generate slug
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

      return c.json({
        success: true,
        file: `ψ/inbox/handoff/${filename}`,
        message: 'Handoff written.'
      }, 201);
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  // Inbox
  app.get('/api/inbox', (c) => {
    const limit = parseInt(c.req.query('limit') || '10');
    const offset = parseInt(c.req.query('offset') || '0');
    const type = c.req.query('type') || 'all';

    const inboxDir = path.join(REPO_ROOT, 'ψ/inbox');
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

    return c.json({ files: paginated, total, limit, offset });
  });
}
