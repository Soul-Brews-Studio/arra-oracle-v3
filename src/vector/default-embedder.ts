import type { EmbedderConfig, EmbeddingProviderType } from './types.ts';

function has(...keys: string[]): boolean {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

export function zeroConfigEmbedder(model: string): EmbedderConfig {
  const fallbackChain: EmbeddingProviderType[] = [];
  if (has('OPENAI_API_KEY')) fallbackChain.push('openai');
  if (has('GEMINI_API_KEY', 'GOOGLE_API_KEY')) fallbackChain.push('gemini');
  if (has('CF_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID') && has('CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN')) {
    fallbackChain.push('cloudflare-ai');
  }

  return {
    backend: 'ollama',
    model,
    ...(fallbackChain.length > 0 && { fallbackChain }),
  };
}
