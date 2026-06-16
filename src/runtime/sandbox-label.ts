export const SANDBOX_LABEL_HEADER = 'X-Sandbox-Label';

export function sandboxLabel(env = process.env.ARRA_ENV): string {
  const value = env?.trim().toLowerCase();
  if (value === 'production') return 'prod';
  if (value === 'staging') return 'staging';
  return 'dev';
}
