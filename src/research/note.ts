import type { StormforgeEvidence, StormforgeFinding } from '../oracles/model.ts';
import { renderDistilledAwakening } from '../trace/distill.ts';

export type ResearchNoteLearning = {
  success: true;
  pattern: string;
  source: string;
  concepts: string[];
  project?: string;
};
export type ResearchNoteError = { success: false; error: string };

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(text).filter((item): item is string => !!item);
  return list.length ? list : undefined;
}

function evidenceList(value: unknown): StormforgeEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const record = raw as Record<string, unknown>;
      const summary = text(record.summary);
      if (!summary) return null;
      const item: StormforgeEvidence = { summary };
      const path = text(record.path);
      const title = text(record.title);
      const url = text(record.url);
      if (path) item.path = path;
      if (title) item.title = title;
      if (url) item.url = url;
      return item;
    })
    .filter((item): item is StormforgeEvidence => !!item);
  return items.length ? items : undefined;
}

function issueNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function researchFinding(input: Record<string, unknown>): StormforgeFinding {
  return {
    issue: issueNumber(input.issue),
    repo: text(input.repo),
    title: text(input.title),
    question: text(input.question),
    repoEvidence: evidenceList(input.repoEvidence),
    externalSources: evidenceList(input.externalSources),
    hypotheses: stringList(input.hypotheses),
    recommendation: text(input.recommendation),
    implementationPlan: stringList(input.implementationPlan),
    verificationPlan: stringList(input.verificationPlan),
    openQuestions: stringList(input.openQuestions),
  };
}

export function buildResearchNoteLearning(input: Record<string, unknown>): ResearchNoteLearning | ResearchNoteError {
  const title = text(input.title);
  if (!title) return { success: false, error: 'oracle_research_note requires title' };
  const finding = researchFinding({ ...input, title });
  const pattern = renderDistilledAwakening({
    traceId: 'research-note',
    awakening: title,
    finding,
    metadata: { oracle: 'thor-oracle', theme: 'stormforge' },
  });
  return {
    success: true,
    pattern,
    source: text(input.source) ?? 'Thor Stormforge research note',
    concepts: ['thor-oracle', 'stormforge', 'dev-research', ...(stringList(input.concepts) ?? [])],
    project: text(input.project) ?? finding.repo,
  };
}
