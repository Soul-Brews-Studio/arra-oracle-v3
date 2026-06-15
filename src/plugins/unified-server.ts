import type { UnifiedRuntime } from './unified-loader.ts';

type Spawned = ReturnType<typeof Bun.spawn>;

export interface UnifiedServerRuntime {
  started: number;
  stop: () => Promise<void>;
}

function commandFor(server: UnifiedRuntime['servers'][number]): string[] | null {
  if (!server.command || server.autostart === false) return null;
  return [server.command, ...(server.args ?? [])];
}

export function startUnifiedPluginServers(
  servers: UnifiedRuntime['servers'],
  warn: (message: string) => void = console.warn,
): UnifiedServerRuntime {
  const children: Spawned[] = [];
  for (const server of servers) {
    const cmd = commandFor(server);
    if (!cmd) continue;
    try {
      children.push(Bun.spawn(cmd, {
        env: { ...process.env, ...(server.env ?? {}) },
        stdout: 'inherit',
        stderr: 'inherit',
      }));
    } catch (error) {
      warn(`[unified-plugin] server ${server.plugin} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    started: children.length,
    stop: async () => {
      for (const child of [...children].reverse()) {
        try {
          child.kill();
          await child.exited;
        } catch {
          // best effort on shutdown
        }
      }
    },
  };
}
