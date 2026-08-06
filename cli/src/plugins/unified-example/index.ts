import type { InvokeContext, InvokeResult } from '../../plugin/types.ts';

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  if (ctx.source === 'api') {
    return {
      ok: true,
      body: {
        ok: true,
        plugin: 'unified-example',
        source: ctx.source,
        method: ctx.request?.method ?? 'GET',
        body: ctx.body ?? null,
      },
    };
  }

  if (ctx.source === 'lifecycle') {
    ctx.server?.logger?.info(`[unified-example] ${ctx.lifecycle}`);
    return { ok: true };
  }

  return {
    ok: true,
    output: 'Hello from the unified-example plugin (cli surface)',
  };
}
