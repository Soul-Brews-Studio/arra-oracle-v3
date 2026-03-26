/**
 * Simple LLM Client for Oracle Tools
 *
 * Supports Anthropic Claude via API and Ollama for local models.
 */

export interface LLMClient {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

/**
 * Anthropic Claude API Client
 *
 * Supports:
 * - ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN for authentication
 * - ANTHROPIC_BASE_URL for custom endpoints (e.g., proxy services)
 */
export class AnthropicClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private version: string;

  constructor(apiKey?: string) {
    // Support both ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN
    this.apiKey = apiKey ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      '';

    if (!this.apiKey) {
      throw new Error('Anthropic API key required. Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.');
    }

    // Support custom base URL for proxy services
    const customBase = process.env.ANTHROPIC_BASE_URL;
    if (customBase) {
      // Append /v1/messages if not already present
      this.baseUrl = customBase.endsWith('/messages')
        ? customBase
        : customBase.endsWith('/v1/messages')
          ? customBase
          : `${customBase}/v1/messages`;
    } else {
      this.baseUrl = 'https://api.anthropic.com/v1/messages';
    }

    this.version = '2023-06-01';
  }

  async complete(prompt: string, options: LLMOptions = {}): Promise<string> {
    const {
      maxTokens = 4096,
      temperature = 0.3,
      model = 'claude-sonnet-4-20250514'
    } = options;

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': this.version,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${error}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    return data.content[0].text;
  }
}

/**
 * Ollama Client (local models)
 */
export class OllamaClient implements LLMClient {
  private baseUrl: string;
  private model: string;

  constructor(config: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = config.model || 'llama3';
  }

  async complete(prompt: string, options: LLMOptions = {}): Promise<string> {
    const {
      model = this.model,
      temperature = 0.3,
    } = options;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${error}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  }
}

/**
 * Create LLM client from environment or config
 */
export function createLLMClient(type?: 'anthropic' | 'ollama'): LLMClient {
  const llmType = type || (process.env.LLM_PROVIDER as 'anthropic' | 'ollama') || 'anthropic';

  switch (llmType) {
    case 'ollama':
      return new OllamaClient();
    case 'anthropic':
    default:
      return new AnthropicClient();
  }
}

/**
 * Extract JSON from LLM response
 * Handles markdown code blocks and plain JSON
 */
export function extractJSON(response: string): any {
  // Try markdown code block first
  const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1]);
  }

  // Try plain JSON
  const plainMatch = response.match(/(\{[\s\S]*\})/);
  if (plainMatch) {
    return JSON.parse(plainMatch[1]);
  }

  throw new Error('No JSON found in LLM response');
}
