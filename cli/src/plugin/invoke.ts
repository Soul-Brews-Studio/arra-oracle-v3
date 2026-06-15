import type { LoadedPlugin, InvokeContext, InvokeResult, ResolvedCliCommand } from "./types.ts";

const TIMEOUT_MS = Number(process.env.ARRA_PLUGIN_TIMEOUT_MS ?? 5000);

type PluginModule = Record<string, unknown> & { default?: unknown };
type Handler = (ctx: InvokeContext) => InvokeResult | Promise<InvokeResult>;

async function invokeHandler(label: string, handler: unknown, ctx: InvokeContext): Promise<InvokeResult> {
  if (typeof handler !== "function") {
    return { ok: false, error: `${label}: handler must be a function` };
  }
  const result = await Promise.race([
    (handler as Handler)(ctx),
    new Promise<InvokeResult>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    ),
  ]);
  return result ?? { ok: true };
}

export async function invokePlugin(plugin: LoadedPlugin, ctx: InvokeContext): Promise<InvokeResult> {
  try {
    const mod = await import(plugin.entryPath) as PluginModule;
    return await invokeHandler(`plugin ${plugin.manifest.name}`, mod.default, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function invokePluginCommand(command: ResolvedCliCommand, ctx: InvokeContext): Promise<InvokeResult> {
  try {
    const mod = await import(command.plugin.entryPath) as PluginModule;
    const handler = command.handler ? mod[command.handler] : mod.default;
    return await invokeHandler(`plugin ${command.plugin.manifest.name} command ${command.command}`, handler, ctx);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
