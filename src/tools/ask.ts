import { answerOracleAsk, type AskInput } from '../routes/ask/index.ts';
import type { ToolResponse } from './types.ts';

export const askToolDef = {
  name: 'oracle_ask',
  description: 'Ask Oracle for a grounded answer over memory/search. Returns answer, citations, citationIndexes, warnings, noEvidence, search metadata, and sources.',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Question to answer. Alias: question.' },
      question: { type: 'string', description: 'Question to answer. Alias: q.' },
      type: { type: 'string', enum: ['principle', 'pattern', 'learning', 'retro', 'all'], description: 'Filter evidence by document type', default: 'all' },
      limit: { type: 'number', description: 'Maximum evidence sources to use (1-20)', default: 8 },
      project: { type: 'string', description: 'Filter by project; includes project plus universal results.' },
      cwd: { type: 'string', description: 'Auto-detect project from a working directory path.' },
      model: { type: 'string', enum: ['nomic', 'qwen3', 'bge-m3'], description: 'Embedding model for retrieval.' },
      asOf: { type: 'string', description: 'Valid-time timestamp for historical answers, e.g. 2026-06-17T00:00:00Z.' },
      llm: { type: 'boolean', description: 'Set false for deterministic extractive answers without an LLM call.', default: true },
    },
    anyOf: [{ required: ['q'] }, { required: ['question'] }],
  },
};

export async function handleAsk(input: AskInput): Promise<ToolResponse> {
  const result = await answerOracleAsk(input ?? {});
  return {
    content: [{ type: 'text', text: JSON.stringify(result.body, null, 2) }],
    ...(result.status >= 400 ? { isError: true } : {}),
  };
}
