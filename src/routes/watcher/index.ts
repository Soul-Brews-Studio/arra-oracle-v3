import { Elysia } from 'elysia';
import { fileWatcherService, type FileWatcherService } from '../../services/file-watcher.ts';

export function createWatcherRoutes(service: FileWatcherService = fileWatcherService) {
  return new Elysia({ prefix: '/api' })
    .get('/watcher/status', () => service.status(), {
      detail: { tags: ['watcher'], summary: 'File watcher daemon status' },
    })
    .post('/watcher/start', () => service.start(), {
      detail: { tags: ['watcher'], summary: 'Start the ψ/learn file watcher daemon' },
    })
    .post('/watcher/stop', () => service.stop(), {
      detail: { tags: ['watcher'], summary: 'Stop the ψ/learn file watcher daemon' },
    });
}

export const watcherRoutes = createWatcherRoutes();
