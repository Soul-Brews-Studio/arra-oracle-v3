/**
 * Gateway hook pipeline — optional middleware that runs before/after proxy.
 *
 * Hooks are keyed by phase:
 *   - onRequest:  runs before proxy dispatch (can short-circuit with a Response)
 *   - onResponse: runs after a successful proxy response
 *   - onError:    runs when the proxy (or an onRequest hook) throws
 *
 * If no hooks are configured the pipeline is a no-op.
 */
import type { MatchedRoute } from './matcher.ts';
import type { ServiceConfig } from './config.ts';

// ── Types ──────────────────────────────────────────────────────────

export type HookPhase = 'onRequest' | 'onResponse' | 'onError';

export interface GatewayContext {
  request: Request;
  route?: MatchedRoute;
  service?: ServiceConfig;
  response?: Response;
  error?: Error;
  /** Arbitrary per-request metadata hooks can read/write. */
  meta: Record<string, unknown>;
}

export interface GatewayHook {
  name: string;
  phase: HookPhase;
  handler: (ctx: GatewayContext) => Response | void | Promise<Response | void>;
}

export interface HooksConfig {
  onRequest?: string[];
  onResponse?: string[];
  onError?: string[];
}

// ── Registry ───────────────────────────────────────────────────────

const builtins = new Map<string, GatewayHook>();

/** Register a built-in hook so the loader can find it by name. */
export function registerHook(hook: GatewayHook): void {
  builtins.set(hook.name, hook);
}

// ── Loader ─────────────────────────────────────────────────────────

/** Resolve hook names from config into ordered GatewayHook arrays per phase. */
export function loadHooks(
  cfg: HooksConfig | undefined,
): Record<HookPhase, GatewayHook[]> {
  const pipeline: Record<HookPhase, GatewayHook[]> = {
    onRequest: [],
    onResponse: [],
    onError: [],
  };
  if (!cfg) return pipeline;

  for (const phase of ['onRequest', 'onResponse', 'onError'] as HookPhase[]) {
    const names = cfg[phase] ?? [];
    for (const name of names) {
      const hook = builtins.get(name);
      if (!hook) {
        console.warn(`[Gateway] unknown hook "${name}" in ${phase} — skipped`);
        continue;
      }
      if (hook.phase !== phase) {
        console.warn(`[Gateway] hook "${name}" registered for ${hook.phase}, not ${phase} — skipped`);
        continue;
      }
      pipeline[phase].push(hook);
    }
  }
  return pipeline;
}

// ── Runner ─────────────────────────────────────────────────────────

/**
 * Run all hooks for a given phase. Returns a Response if any hook
 * short-circuits, otherwise undefined.
 */
export async function runHooks(
  hooks: GatewayHook[],
  ctx: GatewayContext,
): Promise<Response | void> {
  for (const hook of hooks) {
    const result = await hook.handler(ctx);
    if (result instanceof Response) return result;
  }
}
