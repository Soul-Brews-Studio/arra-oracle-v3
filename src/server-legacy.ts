/**
 * Oracle v2 HTTP Server
 *
 * Web viewer for Oracle knowledge base.
 * Exposes same functionality as MCP but via HTTP.
 *
 * Endpoints:
 * - GET /health          - Health check
 * - GET /search?q=...    - Search Oracle knowledge
 * - GET /list            - Browse all documents (no query needed)
 * - GET /reflect         - Random wisdom
 * - GET /stats           - Database statistics
 * - GET /graph           - Knowledge graph data
 * - GET /context?cwd=... - Project context from ghq path
 * - POST /learn          - Add new pattern/learning
 */

import http from 'http';
import url from 'url';
import fs from 'fs';
import {
  configure,
  writePidFile,
  removePidFile,
  registerSignalHandlers,
  performGracefulShutdown,
} from './process-manager/index.ts';

// Config constants (no DB dependency)
import {
  PORT,
  REPO_ROOT,
  DB_PATH,
  UI_PATH,
  ARTHUR_UI_PATH,
  DASHBOARD_PATH,
} from './config.ts';
import { sqlite as db, closeDb } from './db/index.ts';

import {
  handleSearch,
  handleReflect,
  handleList,
  handleStats,
  handleGraph,
  handleLearn
} from './server/handlers.ts';

import {
  handleDashboardSummary,
  handleDashboardActivity,
  handleDashboardGrowth
} from './server/dashboard.ts';

import { handleContext } from './server/context.ts';

import {
  handleThreadMessage,
  listThreads,
  getFullThread,
  getMessages,
  updateThreadStatus
} from './forum/handler.ts';

import path from 'path';

// Frontend static file serving
const FRONTEND_DIST = path.join(import.meta.dirname || __dirname, '..', 'frontend', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(res: http.ServerResponse, filePath: string): boolean {
  const fullPath = path.join(FRONTEND_DIST, filePath);

  // Security: prevent path traversal
  const realPath = path.resolve(fullPath);
  if (!realPath.startsWith(path.resolve(FRONTEND_DIST))) {
    return false;
  }

  if (fs.existsSync(realPath) && fs.statSync(realPath).isFile()) {
    const ext = path.extname(realPath);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.end(fs.readFileSync(realPath));
    return true;
  }
  return false;
}

// Reset stale indexing status on startup
// If server is starting, indexer isn't running - clear any stuck status
try {
  db.prepare('UPDATE indexing_status SET is_indexing = 0 WHERE id = 1').run();
  console.log('🔮 Reset indexing status on startup');
} catch (e) {
  // Table might not exist yet - that's fine
}

// Configure process lifecycle management
const dataDir = path.join(import.meta.dirname || __dirname, '..');
configure({ dataDir });

// Write PID file for process tracking
writePidFile({ pid: process.pid, port: Number(PORT), startedAt: new Date().toISOString(), name: 'oracle-http' });

// Register graceful shutdown handlers
registerSignalHandlers(async () => {
  console.log('\n🔮 Shutting down gracefully...');
  await performGracefulShutdown({
    resources: [
      { close: () => { closeDb(); return Promise.resolve(); } }
    ]
  });
  removePidFile();
  console.log('👋 Oracle v2 HTTP Server stopped.');
});

/**
 * HTTP request handler
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    let result: any;

    // POST /api/thread - Send message to thread
    if (pathname === '/api/thread' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.message) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing required field: message' }));
            return;
          }
          const result = await handleThreadMessage({
            message: data.message,
            threadId: data.thread_id,
            title: data.title,
            role: data.role || 'human'
          });
          res.end(JSON.stringify({
            thread_id: result.threadId,
            message_id: result.messageId,
            status: result.status,
            oracle_response: result.oracleResponse,
            issue_url: result.issueUrl
          }, null, 2));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      });
      return;
    }

    // GET /api/thread/:id - Get thread with messages
    if (pathname?.startsWith('/api/thread/') && req.method === 'GET') {
      const threadId = parseInt(pathname.replace('/api/thread/', ''), 10);
      if (isNaN(threadId)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid thread ID' }));
        return;
      }
      const threadData = getFullThread(threadId);
      if (!threadData) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Thread not found' }));
        return;
      }
      res.end(JSON.stringify({
        thread: {
          id: threadData.thread.id,
          title: threadData.thread.title,
          status: threadData.thread.status,
          created_at: new Date(threadData.thread.createdAt).toISOString(),
          issue_url: threadData.thread.issueUrl
        },
        messages: threadData.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          author: m.author,
          principles_found: m.principlesFound,
          patterns_found: m.patternsFound,
          created_at: new Date(m.createdAt).toISOString()
        }))
      }, null, 2));
      return;
    }

    // PATCH /api/thread/:id/status - Update thread status
    if (pathname?.match(/^\/api\/thread\/\d+\/status$/) && req.method === 'PATCH') {
      const threadId = parseInt(pathname.split('/')[3], 10);
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.status) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing required field: status' }));
            return;
          }
          updateThreadStatus(threadId, data.status);
          res.end(JSON.stringify({ success: true, thread_id: threadId, status: data.status }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // POST /learn
    if (pathname === '/api/learn' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.pattern) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing required field: pattern' }));
            return;
          }
          const result = handleLearn(data.pattern, data.source, data.concepts);
          res.end(JSON.stringify(result, null, 2));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      });
      return;
    }

    switch (pathname) {
      case '/':
        // Serve React SPA at root
        res.setHeader('Content-Type', 'text/html');
        const rootIndex = path.join(FRONTEND_DIST, 'index.html');
        if (fs.existsSync(rootIndex)) {
          res.end(fs.readFileSync(rootIndex));
        } else {
          // Fallback to old Arthur UI if no build exists
          res.end(fs.readFileSync(ARTHUR_UI_PATH, 'utf-8'));
        }
        return;

      // Legacy HTML UIs
      case '/legacy/arthur':
        res.setHeader('Content-Type', 'text/html');
        res.end(fs.readFileSync(ARTHUR_UI_PATH, 'utf-8'));
        return;

      case '/legacy/oracle':
        res.setHeader('Content-Type', 'text/html');
        res.end(fs.readFileSync(UI_PATH, 'utf-8'));
        return;

      case '/legacy/dashboard':
        res.setHeader('Content-Type', 'text/html');
        res.end(fs.readFileSync(DASHBOARD_PATH, 'utf-8'));
        return;

      case '/api/health':
        result = { status: 'ok', server: 'oracle-v2', port: PORT, oracleV2: 'connected' };
        break;

      case '/api/search':
        if (!query.q) {
          res.statusCode = 400;
          result = { error: 'Missing query parameter: q' };
        } else {
          const searchResult = await handleSearch(
            query.q as string,
            (query.type as string) || 'all',
            parseInt(query.limit as string) || 10,
            parseInt(query.offset as string) || 0
          );
          result = {
            ...searchResult,
            query: query.q
          };
        }
        break;

      case '/api/reflect':
        result = handleReflect();
        break;

      case '/api/stats':
        result = handleStats(DB_PATH);
        break;

      case '/api/logs':
        // Return recent search logs for debugging
        try {
          const logs = db.prepare(`
            SELECT query, type, mode, results_count, search_time_ms, created_at, project
            FROM search_log
            ORDER BY created_at DESC
            LIMIT ?
          `).all(parseInt(query.limit as string) || 20);
          result = { logs, total: logs.length };
        } catch (e) {
          result = { logs: [], error: 'Log table not found' };
        }
        break;

      case '/api/list':
        result = handleList(
          (query.type as string) || 'all',
          parseInt(query.limit as string) || 10,
          parseInt(query.offset as string) || 0,
          query.group !== 'false'  // default true, pass group=false to disable
        );
        break;

      case '/api/graph':
        result = handleGraph();
        break;

      // Dashboard endpoints
      case '/api/dashboard':
      case '/api/dashboard/summary':
        result = handleDashboardSummary();
        break;

      case '/api/dashboard/activity':
        result = handleDashboardActivity(
          parseInt(query.days as string) || 7
        );
        break;

      case '/api/dashboard/growth':
        result = handleDashboardGrowth(
          (query.period as string) || 'week'
        );
        break;

      case '/api/context':
        // Return project context from ghq-format path
        result = handleContext(query.cwd as string | undefined);
        break;

      case '/api/file':
        // Return full file content
        const filePath = query.path as string;
        if (!filePath) {
          result = { error: 'Missing path parameter' };
        } else {
          try {
            const fullPath = path.join(REPO_ROOT, filePath);

            // Security: resolve symlinks and verify path is within REPO_ROOT
            // This prevents path traversal attacks via symlinks
            let realPath: string;
            try {
              realPath = fs.realpathSync(fullPath);
            } catch {
              // File doesn't exist - use resolved path for bounds check
              realPath = path.resolve(fullPath);
            }

            // Get real REPO_ROOT path (in case it contains symlinks)
            const realRepoRoot = fs.realpathSync(REPO_ROOT);

            if (!realPath.startsWith(realRepoRoot)) {
              result = { error: 'Invalid path: outside repository bounds' };
            } else if (fs.existsSync(fullPath)) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              result = { path: filePath, content };
            } else {
              result = { error: 'File not found' };
            }
          } catch (e: any) {
            result = { error: e.message };
          }
        }
        break;

      // Forum endpoints
      case '/api/threads':
        const threadList = listThreads({
          status: query.status as any,
          limit: parseInt(query.limit as string) || 20,
          offset: parseInt(query.offset as string) || 0
        });
        result = {
          threads: threadList.threads.map(t => ({
            id: t.id,
            title: t.title,
            status: t.status,
            message_count: getMessages(t.id).length,
            created_at: new Date(t.createdAt).toISOString(),
            issue_url: t.issueUrl
          })),
          total: threadList.total
        };
        break;

      default:
        // Try to serve static files from frontend/dist
        if (pathname && serveStatic(res, pathname)) {
          return;
        }

        // For SPA: serve index.html for non-API routes (client-side routing)
        const indexPath = path.join(FRONTEND_DIST, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.setHeader('Content-Type', 'text/html');
          res.end(fs.readFileSync(indexPath));
          return;
        }

        // Fallback: API 404
        res.statusCode = 404;
        result = {
          error: 'Not found',
          endpoints: [
            'GET /health - Health check',
            'GET /search?q=... - Search Oracle',
            'GET /list - Browse all documents',
            'GET /reflect - Random wisdom',
            'GET /stats - Database stats',
            'GET /graph - Knowledge graph data',
            'GET /context?cwd=... - Project context from ghq path',
            'POST /learn - Add new pattern/learning',
            'GET /dashboard - Dashboard summary',
            'GET /dashboard/activity?days=7 - Recent activity',
            'GET /dashboard/growth?period=week - Growth over time',
            'GET /threads - List discussion threads',
            'GET /thread/:id - Get thread with messages',
            'POST /thread - Send message to thread (Oracle auto-responds)'
          ]
        };
    }

    res.end(JSON.stringify(result, null, 2));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }));
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`
🔮 Oracle v2 HTTP Server running!

   URL: http://localhost:${PORT}

   Endpoints:
   - GET /health          Health check
   - GET /search?q=...    Search Oracle knowledge
   - GET /list            Browse all documents
   - GET /reflect         Random wisdom
   - GET /stats           Database statistics
   - GET /graph           Knowledge graph data
   - GET /context         Project context (ghq format)
   - POST /learn          Add new pattern/learning

   Examples:
   curl http://localhost:${PORT}/health
   curl http://localhost:${PORT}/search?q=nothing+deleted
   curl http://localhost:${PORT}/list?type=learning&limit=5
   curl http://localhost:${PORT}/reflect
   curl http://localhost:${PORT}/stats
   curl http://localhost:${PORT}/graph
   curl http://localhost:${PORT}/context
   curl -X POST http://localhost:${PORT}/learn -H "Content-Type: application/json" \\
     -d '{"pattern":"Always verify before destructive operations","concepts":["safety","git"]}'
`);
});

// Note: Graceful shutdown is handled by bun-process-manager's registerSignalHandlers()
