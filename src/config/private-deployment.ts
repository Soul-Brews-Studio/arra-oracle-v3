import type { RuntimeEnv } from './schema.ts';

export function validatePrivateDeployment(env: RuntimeEnv, issues: string[]): void {
  if (env.ORACLE_PRIVATE_DEPLOYMENT?.trim() !== '1') return;
  // HTTP and MCP have separate guards. A MCP-only token would leave /api/*
  // fail-open, so private mode requires the existing HTTP bearer explicitly.
  if (!filled(env.ARRA_API_TOKEN)) issues.push('private deployment requires ARRA_API_TOKEN for HTTP API protection.');
  if (!filled(env.ORACLE_BIND_HOST)) issues.push('private deployment requires ORACLE_BIND_HOST for loopback binding.');
  else if (!isLoopbackHost(env.ORACLE_BIND_HOST!)
    && !(env.ARRA_PRIVATE_CONTAINER === '1' && env.ORACLE_BIND_HOST!.trim() === '0.0.0.0')) {
    issues.push('ORACLE_BIND_HOST must be loopback-only in private deployment (or 0.0.0.0 only inside the loopback-published private container).');
  }
  if (filled(env.ARRA_API_KEY) && filled(env.ARRA_API_TOKEN) && env.ARRA_API_KEY!.trim() !== env.ARRA_API_TOKEN!.trim()) {
    issues.push('private deployment requires ARRA_API_KEY and ARRA_API_TOKEN to match when both are configured.');
  }
  const llmEnabled = ['1', 'true', 'yes'].includes((env.ORACLE_ASK_LLM ?? '').trim().toLowerCase())
    || ['1', 'true', 'yes'].includes((env.ORACLE_CONSOLIDATION_LLM ?? '').trim().toLowerCase());
  if (!llmEnabled) return;
  const configured = env.ARRA_LLM_PROVIDERS?.trim() || env.ARRA_LLM_PROVIDER?.trim();
  const providers = (configured ? configured.split(',') : inferProviders(env)).map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (configured && !providers.length) issues.push('private LLM adapter requires a non-empty ARRA_LLM_PROVIDERS value.');
  for (const provider of providers) {
    if (provider === 'hermes') {
      if (!filled(env.HERMES_API_KEY)) issues.push('private Hermes adapter requires HERMES_API_KEY.');
      if (!filled(env.HERMES_MODEL)) issues.push('private Hermes adapter requires HERMES_MODEL.');
      validateLoopbackProviderUrl('HERMES_CHAT_URL', env.HERMES_CHAT_URL, issues);
    } else if (provider === 'codex') {
      if (!filled(env.CODEX_BRIDGE_KEY)) issues.push('private Codex bridge requires CODEX_BRIDGE_KEY.');
      validateLoopbackProviderUrl('CODEX_CHAT_URL', env.CODEX_CHAT_URL, issues);
    } else if (provider === 'openai') {
      if (!filled(env.OPENAI_API_KEY)) issues.push('private OpenAI adapter requires OPENAI_API_KEY.');
      if (!filled(env.OPENAI_CHAT_MODEL)) issues.push('private OpenAI adapter requires OPENAI_CHAT_MODEL.');
    } else {
      issues.push(`private LLM adapter provider is unsupported: ${provider}.`);
    }
  }
  for (const key of ['ORACLE_ASK_LLM_URL', 'ORACLE_CONSOLIDATION_LLM_URL']) {
    if (!filled(env[key])) issues.push(`${key} is required when private LLM is enabled.`);
    else if (!isLoopbackUrl(env[key]!)) issues.push(`${key} must be loopback-only in private deployment.`);
  }
}

function inferProviders(env: RuntimeEnv): string[] {
  if (filled(env.HERMES_API_KEY) || filled(env.HERMES_MODEL) || filled(env.HERMES_CHAT_URL)) return ['hermes'];
  if (filled(env.OPENAI_API_KEY) || filled(env.OPENAI_CHAT_MODEL) || filled(env.OPENAI_CHAT_URL)) return ['openai'];
  return [];
}

function validateLoopbackProviderUrl(label: string, value: string | undefined, issues: string[]): void {
  if (!filled(value)) return;
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !isLoopbackUrl(candidate) || url.pathname !== '/v1/chat/completions' || url.search || url.username || url.password) {
      issues.push(`${label} must be a loopback /v1/chat/completions URL in private deployment.`);
    }
  } catch {
    issues.push(`${label} must be a valid loopback /v1/chat/completions URL in private deployment.`);
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch { return false; }
}

function isLoopbackHost(value: string): boolean {
  return ['127.0.0.1', 'localhost', '::1'].includes(value.trim().replace(/^\[|\]$/g, ''));
}

function filled(value: string | undefined): value is string { return Boolean(value?.trim()); }
