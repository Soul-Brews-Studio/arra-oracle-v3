import { describe, expect, test } from 'bun:test';
import { VectorProviderConfigFields } from '../../../frontend/src/components/VectorProviderConfigFields';
import { htmlFor } from '../_render';

describe('VectorProviderConfigFields', () => {
  test('renders empty selection and unknown provider guidance', () => {
    expect(htmlFor(<VectorProviderConfigFields />)).toContain('Select a provider to configure credentials');

    const html = htmlFor(<VectorProviderConfigFields provider={{ type: 'remote', available: false }} />);
    expect(html).toContain('Provider status: not detected.');
    expect(html).toContain('Models: No models detected yet.');
  });

  test('renders provider-specific credential and model fields', () => {
    const ollama = htmlFor(
      <VectorProviderConfigFields provider={{ type: 'ollama', available: true, status: 'running', models: ['bge-m3'], capabilities: ['GPU: Metal'] }} />,
    );
    expect(ollama).toContain('Running status:');
    expect(ollama).toContain('GPU:');
    expect(ollama).toContain('bge-m3');

    expect(htmlFor(<VectorProviderConfigFields provider={{ type: 'openai', available: true }} />)).toContain('OpenAI API key');
    expect(htmlFor(<VectorProviderConfigFields provider={{ type: 'gemini', available: true }} />)).toContain('Google Gemini API key');
    expect(htmlFor(<VectorProviderConfigFields provider={{ type: 'cloudflare-ai', available: true }} />)).toContain('Cloudflare account ID');
  });
});
