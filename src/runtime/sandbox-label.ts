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

export function sandboxLabel(env: unknown = process.env.ARRA_ENV): SandboxLabel {
  if (typeof env !== 'string') return 'dev';
  return labels[env.trim().toLowerCase()] ?? 'dev';
}
