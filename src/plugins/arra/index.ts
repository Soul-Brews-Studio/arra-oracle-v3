type ArraPluginContext = {
  source: 'api' | 'mcp' | 'cli' | 'server' | 'init' | 'destroy';
  plugin: string;
  args?: unknown[];
  request?: Request;
};

type ArraVerb = {
  name: string;
  help: string;
  menuPath: string;
  httpPath: string;
  requiresEmbedder: boolean;
  storage: 'swappable';
};

const VERSION = '1.0.0';
const MENU_PATH = '/plugins/arra';
const HTTP_PATH = '/api/plugins/arra';

const VERBS: ArraVerb[] = [
  { name: 'help', help: 'Show ARRA plugin commands', menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: 'swappable' },
  { name: 'version', help: 'Print ARRA plugin version', menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: 'swappable' },
  { name: 'menu', help: 'Describe the ARRA menu surface', menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: 'swappable' },
  { name: 'status', help: 'Describe optional backend capabilities', menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: 'swappable' },
];

function commandName(ctx: ArraPluginContext): string {
  const arg = ctx.args?.[0];
  return typeof arg === 'string' && arg.trim() ? arg.trim().toLowerCase() : 'help';
}

function pluginBody(ctx: ArraPluginContext) {
  return {
    plugin: ctx.plugin || 'arra',
    version: VERSION,
    surface: ctx.source,
    menuPath: MENU_PATH,
    httpPath: HTTP_PATH,
    cliCommand: 'arra',
    embedderRequired: false,
    storageBackend: 'swappable',
    verbs: VERBS,
  };
}

function renderCli(ctx: ArraPluginContext): string {
  const command = commandName(ctx);
  if (command === 'version') return `arra ${VERSION}`;
  if (command === 'menu') return `arra menu: ${MENU_PATH}`;
  if (command === 'status') return 'arra status: ok (embedder optional, storage swappable)';
  if (command !== 'help') return `unknown arra command: ${command}\n${renderCli({ ...ctx, args: ['help'] })}`;
  return ['maw arra <command>', ...VERBS.map((verb) => `  ${verb.name.padEnd(8)} ${verb.help}`)].join('\n');
}

export function arraHttpRoute(ctx: ArraPluginContext) {
  return { ok: true, body: pluginBody(ctx) };
}

export function arraCli(ctx: ArraPluginContext) {
  return { ok: true, output: renderCli(ctx) };
}

export default function handler(ctx: ArraPluginContext) {
  return ctx.source === 'cli' ? arraCli(ctx) : arraHttpRoute(ctx);
}
