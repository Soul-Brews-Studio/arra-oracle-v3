import type { LoadedPlugin } from './types';

type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
type JsonRpcMessage = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

export class SubprocessBridge {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';
  readonly tools: McpTool[] = [];

  constructor(private plugin: LoadedPlugin) {}

  async start(): Promise<void> {
    const m = this.plugin.manifest;
    if (m.type !== 'subprocess') return;
    this.proc = Bun.spawn([m.command, ...(m.args ?? [])], {
      cwd: this.plugin.dir,
      env: { ...process.env, ...(m.env ?? {}) },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    this.plugin.pid = this.proc.pid;
    this.readLoop();
    await this.send('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    const toolsResult = await this.send('tools/list', {}) as { tools?: McpTool[] };
    this.tools.push(...(toolsResult?.tools ?? []));
    this.plugin.status = 'healthy';
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.send('tools/call', { name, arguments: args });
  }

  async shutdown(): Promise<void> {
    try {
      await this.send('shutdown', {});
    } catch {}
    this.proc?.kill();
    this.proc = null;
    this.plugin.status = 'disabled';
  }

  private async send(method: string, params: unknown): Promise<unknown> {
    const stdin = this.proc?.stdin;
    if (!stdin || typeof stdin === 'number') throw new Error(`subprocess ${this.plugin.manifest.name} not running`);
    const id = this.nextId++;
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
    const line = JSON.stringify(msg) + '\n';
    stdin.write(line);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout calling ${method} on ${this.plugin.manifest.name}`));
        }
      }, 30_000);
    });
  }

  private async readLoop(): Promise<void> {
    const stdout = this.proc?.stdout;
    if (!stdout || typeof stdout === 'number') return;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, nl).trim();
          this.buffer = this.buffer.slice(nl + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as JsonRpcMessage;
            if (msg.id != null && this.pending.has(msg.id)) {
              const p = this.pending.get(msg.id)!;
              this.pending.delete(msg.id);
              if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
              else p.resolve(msg.result);
            }
          } catch {}
        }
      }
    } catch {}
  }
}

export async function startSubprocessPlugin(plugin: LoadedPlugin): Promise<SubprocessBridge> {
  const bridge = new SubprocessBridge(plugin);
  await bridge.start();
  return bridge;
}
