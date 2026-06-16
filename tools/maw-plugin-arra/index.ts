import { runExportCommand } from './commands/export.ts';
import { runStatusCommand } from './commands/status.ts';
import { runVectorConfigCommand, VECTOR_CONFIG_HELP } from './commands/vector-config.ts';

type InvokeContext = {
  source?: string;
  args?: string[] | Record<string, unknown>;
  body?: unknown;
  writer?: (line?: string) => void;
};

type InvokeResult = { ok: boolean; output?: string; error?: string; exitCode?: number };
type CommandHandler = (args: string[]) => Promise<string>;
type RegistryCommand = {
  name: string;
  help: string;
  surfaces: string[];
};

const surfaces = ['cli', 'api', 'menu'] as const;

export const pluginConfig = {
  dbBackend: 'http',
  embedderBackend: 'none',
  apiBase: 'http://localhost:47778',
  remoteEmbedderUrl: '',
};

export const pluginConfigSchema = {
  type: 'object',
  properties: {
    dbBackend: { type: 'string', enum: ['http', 'sqlite', 'memory', 'custom'] },
    embedderBackend: { type: 'string', enum: ['none', 'local', 'remote'] },
    apiBase: { type: 'string' },
    remoteEmbedderUrl: { type: 'string' },
  },
  additionalProperties: true,
};

const commandHandlers: Record<string, CommandHandler> = {
  commands: runCommandsCommand,
  config: runConfigCommand,
  export: runExportCommand,
  status: () => runStatusCommand(),
  'vector-config': runVectorConfigCommand,
  vector_config: runVectorConfigCommand,
};

export const commandRegistry: RegistryCommand[] = [
  { name: 'commands', help: 'list the shared CLI/API/menu command registry', surfaces: [...surfaces] },
  { name: 'config', help: 'show swappable DB and optional embedder defaults', surfaces: [...surfaces] },
  { name: 'status', help: 'show vector collections, doc counts, and health', surfaces: [...surfaces] },
  { name: 'export', help: 'export app collections as json, csv, md, or jsonl', surfaces: [...surfaces] },
  { name: 'vector-config', help: VECTOR_CONFIG_HELP, surfaces: [...surfaces] },
];

export const command = {
  name: 'arra',
  description: 'ARRA Oracle CLI bridge — export vectors, inspect status, and manage vector config.',
};

function argsFromRecord(record: Record<string, unknown>): string[] {
  const first = typeof record.sub === 'string'
    ? record.sub
    : typeof record.command === 'string'
      ? record.command
      : typeof record.cmd === 'string'
        ? record.cmd
        : '';
  const prefix = first ? [first] : [];
  const explicit = Array.isArray(record.args)
    ? record.args.map(String)
    : Array.isArray(record.argv)
      ? record.argv.map(String)
      : [];
  const flags = Object.entries(record).flatMap(([key, value]) => {
    if (['sub', 'command', 'cmd', 'args', 'argv'].includes(key) || value === undefined || value === null || value === false) return [];
    if (value === true) return [`--${key.replace(/_/g, '-')}`];
    return [`--${key.replace(/_/g, '-')}`, String(value)];
  });
  return [...prefix, ...explicit, ...flags];
}

function argsFromContext(args: InvokeContext['args'], body?: unknown): string[] {
  if (Array.isArray(args)) return args;
  if (args && typeof args === 'object') return argsFromRecord(args);
  if (body && typeof body === 'object' && !Array.isArray(body)) return argsFromRecord(body as Record<string, unknown>);
  return [];
}

function help(): string {
  return [
    'maw arra — ARRA Oracle CLI bridge',
    ...commandRegistry.flatMap((item) => [`  ${item.name}`, `      ${item.help}`]),
  ].join('\n');
}

function wantsJson(args: string[]): boolean {
  return args.includes('--json');
}

function registryText(): string {
  return [
    'arra command registry (shared by CLI/API/menu):',
    ...commandRegistry.map((item) => `  ${item.name.padEnd(14)} ${item.help}`),
  ].join('\n');
}

function registryPayload(source: string) {
  return {
    plugin: 'arra',
    source,
    config: pluginConfig,
    configSchema: pluginConfigSchema,
    menu: { label: 'ARRA Oracle', path: '/plugins/arra', group: 'tools' },
    api: { path: '/api/plugins/arra', methods: ['GET', 'POST'] },
    cli: { command: 'arra' },
    commands: commandRegistry,
  };
}

function isApiLike(source?: string): boolean {
  return source === 'api' || source === 'menu';
}

function apiOutput(command: string, output: string): string {
  return JSON.stringify({ ok: true, command, output }, null, 2);
}

async function runCommandsCommand(args: string[]): Promise<string> {
  return wantsJson(args)
    ? JSON.stringify(registryPayload('cli'), null, 2)
    : registryText();
}

async function runConfigCommand(args: string[]): Promise<string> {
  const payload = { config: pluginConfig, configSchema: pluginConfigSchema };
  if (wantsJson(args)) return JSON.stringify(payload, null, 2);
  return [
    'arra plugin config defaults:',
    `  dbBackend: ${pluginConfig.dbBackend}`,
    `  embedderBackend: ${pluginConfig.embedderBackend}`,
    `  apiBase: ${pluginConfig.apiBase}`,
    '  remoteEmbedderUrl: (unset)',
  ].join('\n');
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = argsFromContext(ctx.args, ctx.body);
  if (!args.length && isApiLike(ctx.source)) {
    return { ok: true, output: JSON.stringify(registryPayload(ctx.source ?? 'api'), null, 2) };
  }
  const subcommand = (args[0] || '').toLowerCase();
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    const output = help();
    return { ok: true, output: isApiLike(ctx.source) ? apiOutput('help', output) : output };
  }

  const run = commandHandlers[subcommand];
  if (!run) return { ok: false, error: help(), exitCode: 2 };

  try {
    const output = await run(args.slice(1));
    if (ctx.writer) ctx.writer(output);
    return { ok: true, output: isApiLike(ctx.source) ? apiOutput(subcommand, output) : output };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), exitCode: 1 };
  }
}
