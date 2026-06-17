import type { SearchResult } from '../../server/types.ts';

export type AskSource = {
  index: number; id: string; type: string; sourceFile: string; score: number;
  excerpt: string; supersededBy?: string; supersededAt?: string | null; supersededReason?: string | null;
};
export type AskPrompt = { instruction: string; question: string; sources: AskSource[] };
export type AskClient = (prompt: AskPrompt) => Promise<unknown>;
export type AskSynthesis = { answer: string; citations: number[]; noEvidence: boolean; mode: 'llm' | 'extractive' };

export function sourcesFrom(results: SearchResult[], limit: number): AskSource[] {
  return results.slice(0, limit).map((result, index) => ({
    index: index + 1,
    id: result.id,
    type: result.type,
    sourceFile: result.source_file,
    score: round(result.score ?? 0),
    excerpt: excerpt(result.content),
    supersededBy: result.superseded_by,
    supersededAt: result.superseded_at,
    supersededReason: result.superseded_reason,
  }));
}

export async function synthesize(question: string, sources: AskSource[], client?: AskClient): Promise<AskSynthesis> {
  const noEvidence = lacksEvidence(sources);
  if (noEvidence) return { answer: 'No evidence found in indexed oracle documents.', citations: [], noEvidence: true, mode: 'extractive' };
  if (!client) return extractiveAnswer(sources, false);
  try {
    const parsed = parseLlm(await client(promptFor(question, sources)));
    if (parsed) return { answer: parsed.answer, citations: validCitations(parsed.citations, sources), noEvidence: Boolean(parsed.noEvidence), mode: 'llm' };
  } catch {}
  return extractiveAnswer(sources, false);
}

export function envAskClient(env: Record<string, string | undefined> = process.env): AskClient | undefined {
  const enabled = ['1', 'true', 'yes'].includes(String(env.ORACLE_ASK_LLM ?? '').toLowerCase());
  const url = env.ORACLE_ASK_LLM_URL?.trim();
  if (!enabled || !url) return undefined;
  return async (prompt) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prompt) });
    if (!response.ok) throw new Error(`ask LLM endpoint failed (${response.status})`);
    return response.text();
  };
}

function lacksEvidence(sources: AskSource[]): boolean {
  return sources.length === 0 || Math.max(...sources.map((source) => source.score)) < 0.12;
}

function promptFor(question: string, sources: AskSource[]): AskPrompt {
  return {
    instruction: [
      'Answer the question using only the provided sources.',
      'Cite factual claims with bracket citations like [1].',
      'If sources do not support an answer, set noEvidence=true.',
      'Return JSON only: {"answer":"...","citations":[1],"noEvidence":false}.',
    ].join(' '),
    question,
    sources,
  };
}

function extractiveAnswer(sources: AskSource[], noEvidence: boolean): AskSynthesis {
  const cited = sources.slice(0, 3);
  return {
    answer: cited.map((source) => `[${source.index}] ${source.excerpt}`).join('\n'),
    citations: cited.map((source) => source.index),
    noEvidence,
    mode: 'extractive',
  };
}

function parseLlm(raw: unknown): { answer: string; citations: number[]; noEvidence?: boolean } | null {
  const payload = typeof raw === 'string' ? jsonish(raw) : raw;
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const answer = typeof record.answer === 'string' ? record.answer.trim() : '';
  if (!answer) return null;
  const citations = Array.isArray(record.citations) ? record.citations.map(Number).filter(Number.isFinite) : [];
  return { answer, citations, noEvidence: Boolean(record.noEvidence ?? record.no_evidence) };
}

function jsonish(raw: string): unknown {
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? raw.trim();
  const start = fenced.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(fenced.slice(start)); } catch { return null; }
}

function validCitations(citations: number[], sources: AskSource[]): number[] {
  const allowed = new Set(sources.map((source) => source.index));
  return Array.from(new Set(citations.filter((citation) => allowed.has(citation))));
}

function excerpt(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 420);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
