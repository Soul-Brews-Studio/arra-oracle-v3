import { findCanvasPlugin, listCanvasPlugins, type CanvasPluginKind } from '../../canvas/plugins.ts';

interface Options {
  json: boolean;
  kind?: CanvasPluginKind;
  id?: string;
}

const VALID_KINDS = new Set<CanvasPluginKind>(['three', 'react']);

function optionValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function parseKind(raw: string): CanvasPluginKind {
  const kind = raw.trim() as CanvasPluginKind;
  if (!VALID_KINDS.has(kind)) throw new Error(`--kind must be one of: ${[...VALID_KINDS].join(', ')}`);
  return kind;
}

function parseText(raw: string, name: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function parseArgs(args: string[]): Options {
  const options: Options = { json: false };
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--kind') options.kind = parseKind(optionValue(args, i++, '--kind'));
    else if (arg.startsWith('--kind=')) options.kind = parseKind(arg.slice('--kind='.length));
    else if (arg === '--id') options.id = parseText(optionValue(args, i++, '--id'), '--id');
    else if (arg.startsWith('--id=')) options.id = parseText(arg.slice('--id='.length), '--id');
    else if (arg) throw new Error(`unknown canvas-plugins option: ${arg}`);
  }
  return options;
}

function printTable(plugins: ReturnType<typeof listCanvasPlugins>): void {
  for (const plugin of plugins) {
    const target = `${plugin.path}?plugin=${plugin.query.plugin}`;
    console.log(`${plugin.id}\t${plugin.kind}\t${plugin.label}\t${target}`);
  }
}

export async function canvasPluginsCommand(args: string[]): Promise<number> {
  try {
    const options = parseArgs(args);
    const plugins = options.id
      ? [findCanvasPlugin(options.id)].filter(Boolean) as ReturnType<typeof listCanvasPlugins>
      : listCanvasPlugins(options.kind);
    if (options.json) console.log(JSON.stringify({ plugins, count: plugins.length }, null, 2));
    else printTable(plugins);
    return plugins.length || !options.id ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
