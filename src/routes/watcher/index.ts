import { Elysia } from 'elysia';
import { fileWatcherService, type FileWatcherService } from '../../services/file-watcher.ts';

type StatusSetter = { status?: number | string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Watcher operation failed');
}

function safeWatcherCall<T>(set: StatusSetter, action: () => T): T | { error: string } {
  try {
    return action();
  } catch (error) {
    set.status = 500;
    return { error: errorMessage(error) };
  }
}

export function createWatcherRoutes(service: FileWatcherService = fileWatcherService) {
  return new Elysia({ prefix: '/api' })
    .get('/watcher/status', ({ set }) => safeWatcherCall(set, () => service.status()), {
      detail: { tags: ['watcher'], summary: 'File watcher daemon status' },
    })
    .post('/watcher/start', ({ set }) => safeWatcherCall(set, () => service.start()), {
      detail: { tags: ['watcher'], summary: 'Start the ψ/learn file watcher daemon' },
    })
    .post('/watcher/stop', ({ set }) => safeWatcherCall(set, () => service.stop()), {
      detail: { tags: ['watcher'], summary: 'Stop the ψ/learn file watcher daemon' },
    });
}

export const watcherRoutes = createWatcherRoutes();
