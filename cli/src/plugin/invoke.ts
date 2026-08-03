import type { LoadedPlugin, InvokeContext, InvokeResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = Number(process.env.ARRA_PLUGIN_TIMEOUT_MS ?? 5000);

export async function invokePlugin(plugin: LoadedPlugin, ctx: InvokeContext): Promise<InvokeResult> {
  try {
    const mod = await import(plugin.entryPath);
    const handler = mod.default;
    if (typeof handler !== "function") {
      return { ok: false, error: `plugin ${plugin.manifest.name}: default export must be a function` };
    }

    const timeoutMs = plugin.manifest.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { promise: timeout, reject } = Promise.withResolvers<InvokeResult>();
    const timer = setTimeout(
      () => reject(new Error(`plugin ${plugin.manifest.name} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    let result: InvokeResult;
    try {
      // Whichever settles first wins; clearing the timer stops a fast success
      // from keeping the event loop alive for the full timeout window.
      result = await Promise.race([handler(ctx) as Promise<InvokeResult>, timeout]);
    } finally {
      clearTimeout(timer);
    }

    return result ?? { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
