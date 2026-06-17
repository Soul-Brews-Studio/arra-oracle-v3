import { getOracleProfile, listOracleProfiles } from '../oracles/registry.ts';
import { handleLearn } from './learn.ts';
import { buildResearchNoteLearning } from '../research/note.ts';
import type { DistillTraceInput } from '../trace/types.ts';
import type { ToolContext, ToolResponse } from './types.ts';

function text(payload: unknown, isError = false): ToolResponse {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], ...(isError && { isError }) };
}

export const oracleProfileToolDef = {
  name: 'oracle_profile',
  description: 'List or read code-backed Oracle profiles such as Thor Oracle / Stormforge.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Profile id, slug, or name. Omit to list profiles.' } },
  },
};

export const oracleTraceDistillToolDef = {
  name: 'oracle_trace_distill',
  description: 'Distill a trace into a Thor/Stormforge awakening and optionally promote it to learning memory.',
  inputSchema: {
    type: 'object',
    properties: {
      traceId: { type: 'string' },
      awakening: { type: 'string' },
      promoteToLearning: { type: 'boolean' },
      oracle: { type: 'string' },
      theme: { type: 'string' },
      concepts: { type: 'array', items: { type: 'string' } },
      source: { type: 'string' },
      finding: { type: 'object', description: 'Optional Stormforge finding artifact.' },
      metadata: { type: 'object', description: 'Optional audit metadata.' },
    },
    required: ['traceId', 'awakening'],
  },
};

export const oracleResearchNoteToolDef = {
  name: 'oracle_research_note',
  description: 'Store a Thor Stormforge research/dev artifact as searchable learning memory.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      question: { type: 'string' },
      recommendation: { type: 'string' },
      repo: { type: 'string' },
      issue: { type: 'number' },
      repoEvidence: { type: 'array', items: { type: 'object' } },
      externalSources: { type: 'array', items: { type: 'object' } },
      hypotheses: { type: 'array', items: { type: 'string' } },
      implementationPlan: { type: 'array', items: { type: 'string' } },
      verificationPlan: { type: 'array', items: { type: 'string' } },
      openQuestions: { type: 'array', items: { type: 'string' } },
      concepts: { type: 'array', items: { type: 'string' } },
      source: { type: 'string' },
      project: { type: 'string' },
    },
    required: ['title'],
  },
};

export function handleOracleProfile(input: { id?: string }): ToolResponse {
  if (!input?.id) return text({ profiles: listOracleProfiles(), total: listOracleProfiles().length });
  const profile = getOracleProfile(input.id);
  return profile ? text(profile) : text({ success: false, error: `Oracle profile not found: ${input.id}` }, true);
}

export async function handleOracleTraceDistill(input: DistillTraceInput): Promise<ToolResponse> {
  if (!input?.traceId || !input?.awakening?.trim()) {
    return text({ success: false, error: 'oracle_trace_distill requires traceId and awakening' }, true);
  }
  const { distillTraceAwakening } = await import('../trace/distill.ts');
  const result = distillTraceAwakening({ ...input, awakening: input.awakening.trim() });
  return text(result, !result.success);
}

export async function handleOracleResearchNote(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResponse> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return text({ success: false, error: 'oracle_research_note requires title' }, true);
  const note = buildResearchNoteLearning(input);
  if (!note.success) return text({ success: false, error: note.error }, true);
  return handleLearn(ctx, {
    pattern: note.pattern,
    source: note.source,
    concepts: note.concepts,
    project: note.project,
  });
}
