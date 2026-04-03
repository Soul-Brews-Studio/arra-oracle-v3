/**
 * Arra Oracle HTTP Server - Hono.js Version
 *
 * Modern routing with Hono.js on Bun runtime.
 * Routes split into modules under src/routes/.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq } from 'drizzle-orm';

import {
  configure,
  writePidFile,
  removePidFile,
  registerSignalHandlers,
  performGracefulShutdown,
} from './process-manager/index.ts';

import { PORT, ORACLE_DATA_DIR } from './config.ts';
import { db, closeDb, indexingStatus } from './db/index.ts';

// Middleware
import { rateLimitMiddleware, RATE_LIMIT_TIERS } from './middleware/rate-limit.ts';

// Route modules
import { registerAuthRoutes } from './routes/auth.ts';
import { registerSettingsRoutes } from './routes/settings.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerFeedRoutes } from './routes/feed.ts';
import { registerDashboardRoutes } from './routes/dashboard.ts';
import { registerForumRoutes } from './routes/forum.ts';
import { registerScheduleRoutes } from './routes/schedule.ts';
import { registerTraceRoutes } from './routes/traces.ts';
import { registerKnowledgeRoutes } from './routes/knowledge.ts';
import { registerSupersedeRoutes } from './routes/supersede.ts';
import { registerFileRoutes } from './routes/files.ts';

// Reset stale indexing status on startup using Drizzle
try {
  db.update(indexingStatus)
    .set({ isIndexing: 0 })
    .where(eq(indexingStatus.id, 1))
    .run();
  console.log('🔮 Reset indexing status on startup');
} catch (e) {
  // Table might not exist yet - that's fine
}

// Configure process lifecycle management
configure({ dataDir: ORACLE_DATA_DIR, pidFileName: 'oracle-http.pid' });

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
  console.log('👋 Arra Oracle HTTP Server stopped.');
});

// Create Hono app
const app = new Hono();

// CORS middleware — restrict to same-origin in production
app.use('*', cors({
  origin: (origin) => {
    // Allow same-origin (no origin header) and localhost variants
    if (!origin) return origin;
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return origin;
    }
    // In production, only allow configured origin
    const allowedOrigin = process.env.CORS_ORIGIN;
    if (allowedOrigin && origin === allowedOrigin) return origin;
    return null; // Reject unknown origins
  },
  credentials: true,
}));

// Security headers middleware
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Rate limiting (before auth, so brute-force is limited even on public endpoints)
app.use('/api/auth/*', rateLimitMiddleware(RATE_LIMIT_TIERS.auth));
app.use('/api/learn', rateLimitMiddleware(RATE_LIMIT_TIERS.write));
app.use('/api/thread', rateLimitMiddleware(RATE_LIMIT_TIERS.write));
app.use('/api/supersede', rateLimitMiddleware(RATE_LIMIT_TIERS.write));
app.use('/api/settings', rateLimitMiddleware(RATE_LIMIT_TIERS.write));
app.use('/api/search', rateLimitMiddleware(RATE_LIMIT_TIERS.read));
app.use('/api/list', rateLimitMiddleware(RATE_LIMIT_TIERS.read));
app.use('/api/file', rateLimitMiddleware(RATE_LIMIT_TIERS.read));
app.use('/api/graph', rateLimitMiddleware(RATE_LIMIT_TIERS.read));
app.use('/api/feed', rateLimitMiddleware(RATE_LIMIT_TIERS.read));
// /api/health is NOT rate limited (monitoring)

// Register all route modules (order matters: auth middleware first)
registerAuthRoutes(app);
registerSettingsRoutes(app);
registerHealthRoutes(app);
registerSearchRoutes(app);
registerFeedRoutes(app);
registerDashboardRoutes(app);
registerForumRoutes(app);
registerScheduleRoutes(app);
registerTraceRoutes(app);
registerKnowledgeRoutes(app);
registerSupersedeRoutes(app);
registerFileRoutes(app);

// Startup banner
console.log(`
🔮 Arra Oracle HTTP Server running! (Hono.js)

   URL: http://localhost:${PORT}

   Endpoints:
   - GET  /api/health          Health check
   - GET  /api/search?q=...    Search Oracle knowledge
   - GET  /api/list            Browse all documents
   - GET  /api/reflect         Random wisdom
   - GET  /api/stats           Database statistics
   - GET  /api/graph           Knowledge graph data
   - GET  /api/map             Knowledge map 2D (hash-based layout)
   - GET  /api/map3d           Knowledge map 3D (real PCA from LanceDB embeddings)
   - GET  /api/context         Project context (ghq format)
   - POST /api/learn           Add new pattern/learning

   Forum:
   - GET  /api/threads         List threads
   - GET  /api/thread/:id      Get thread
   - POST /api/thread          Send message

   Supersede Log:
   - GET  /api/supersede       List supersessions
   - GET  /api/supersede/chain/:path  Document lineage
   - POST /api/supersede       Log supersession
`);

export default {
  port: Number(PORT),
  fetch: app.fetch,
};
