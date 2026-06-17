export const SANDBOX_LABEL_HEADER = 'X-Sandbox-Label';

export type SandboxLabel = 'dev' | 'staging' | 'prod';

const labels: Record<string, SandboxLabel> = {
  development: 'dev',
  dev: 'dev',
  local: 'dev',
  test: 'dev',
  staging: 'staging',
  stage: 'staging',
  production: 'prod',
  prod: 'prod',
};

function envValue(env: unknown): string | undefined {
  if (typeof env === 'string') return env;
  if (!env || typeof env !== 'object') return undefined;
  try {
    const value = (env as Record<string, unknown>).ARRA_ENV;
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function sandboxLabel(env: unknown = process.env.ARRA_ENV): SandboxLabel {
  const value = envValue(env);
  if (!value) return 'dev';
  return labels[value.trim().toLowerCase()] ?? 'dev';
}
