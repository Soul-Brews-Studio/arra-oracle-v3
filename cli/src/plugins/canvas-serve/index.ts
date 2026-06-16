import type { InvokeContext, InvokeResult } from '../../plugin/types.ts';
import { canvasServeCommand } from '../../../../src/cli/commands/canvas-serve.ts';

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const code = await canvasServeCommand(['canvas-serve', ...ctx.args]);
  return code === 0 ? { ok: true } : { ok: false, error: 'canvas-serve failed' };
}
