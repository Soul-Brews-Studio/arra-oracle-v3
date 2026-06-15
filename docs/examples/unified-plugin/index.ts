type UnifiedExampleContext = {
  source: 'api' | 'mcp' | 'cli' | 'server';
  plugin: string;
  request?: Request;
  query?: Record<string, unknown>;
  args?: unknown[];
};

const MENU_PATH = '/tools/canvas-inspector';
const CLI_COMMAND = 'canvas-inspect';

function queryString(ctx: UnifiedExampleContext, key: string): string | null {
  const value = ctx.query?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function canvasInspectorRoute(ctx: UnifiedExampleContext) {
  return {
    ok: true,
    body: {
      plugin: ctx.plugin,
      surface: 'apiRoutes',
      method: ctx.request?.method ?? 'GET',
      id: queryString(ctx, 'id') ?? 'all',
      menuPath: MENU_PATH,
      cliCommand: CLI_COMMAND,
      embedderRequired: false,
    },
  };
}

export function canvasInspectCli(ctx: UnifiedExampleContext) {
  const target = typeof ctx.args?.[0] === 'string' ? ctx.args[0] : 'all';
  return {
    ok: true,
    output: `canvas-inspector:${target} menu=${MENU_PATH}`,
  };
}

export function inspectCanvasPlugin(ctx: UnifiedExampleContext) {
  return {
    ok: true,
    body: {
      plugin: ctx.plugin,
      surface: 'mcpTools',
      readOnly: true,
    },
  };
}

export default canvasInspectorRoute;
