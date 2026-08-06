import type { SearchResult } from '../../server/types.ts';

export type AskSource = {
  index: number; id: string; type: string; title: string; sourceFile: string; score: number; confidence: number;
  excerpt: string; stale: boolean; supersededBy?: string; supersededAt?: string | null; supersededReason?: string | null;
  entityMatches?: string[]; chunk?: { index?: number; lineStart?: number; lineEnd?: number };
};
export type AskCitation = Pick<AskSource, 'index' | 'id' | 'title' | 'sourceFile' | 'excerpt' | 'score' | 'confidence' | 'stale' | 'chunk'>;
export type AskPrompt = { instruction: string; question: string; sources: AskSource[] };
export type AskClient = (prompt: AskPrompt) => Promise<unknown>;
export type AskSynthesis = { answer: string; citations: number[]; noEvidence: boolean; mode: 'llm' | 'extractive' };

type RankedResult = SearchResult & Record<string, unknown>;

export function rankAskResults(results: SearchResult[]): SearchResult[] {
  return results.map((result, index) => ({ ...result, askRank: askRank(result as RankedResult), __askIndex: index }))
    .sort((a, b) => b.askRank - a.askRank || a.__askIndex - b.__askIndex)
    .map(({ askRank: _rank, __askIndex: _index, ...result }) => result as SearchResult);
}

export function sourcesFrom(results: SearchResult[], limit: number): AskSource[] {
  return results.slice(0, limit).map((result, index) => {
    const record = result as RankedResult;
    const sourceFile = result.source_file;
    return {
      index: index + 1,
      id: result.id,
      type: result.type,
      title: titleFrom(sourceFile),
      sourceFile,
      score: round(result.score ?? 0),
      confidence: confidenceFor(record),
      excerpt: excerpt(result.content),
      stale: Boolean(result.superseded_by),
      supersededBy: result.superseded_by,
      supersededAt: result.superseded_at,
      supersededReason: result.superseded_reason,
      entityMatches: arrayOfText(record.entity_matches ?? record.entityLinkMatches),
      chunk: chunkFrom(record),
    };
  });
}

export function citationsFrom(indexes: number[], sources: AskSource[]): AskCitation[] {
  const byIndex = new Map(sources.map((source) => [source.index, source]));
  return indexes.map((index) => byIndex.get(index)).filter((source): source is AskSource => Boolean(source))
    .map(({ index, id, title, sourceFile, excerpt, score, confidence, stale, chunk }) => ({
      index, id, title, sourceFile, excerpt, score, confidence, stale, ...(chunk ? { chunk } : {}),
    }));
}

export function warningsFrom(sources: AskSource[], searchWarning: unknown, noEvidence: boolean): string[] {
  const warnings: string[] = [];
  if (typeof searchWarning === 'string' && searchWarning.trim()) warnings.push(searchWarning.trim());
  if (noEvidence) warnings.push('no_evidence_found');
  for (const source of sources) {
    if (source.stale) warnings.push(`source[${source.index}] superseded by ${source.supersededBy ?? 'another document'}${source.supersededReason ? `: ${source.supersededReason}` : ''}`);
    if (source.confidence < 0.45) warnings.push(`source[${source.index}] low confidence`);
  }
  return [...new Set(warnings)];
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

function askRank(result: RankedResult): number {
  const score = safeScore(result.score);
  const entity = safeScore(result.entity_score ?? result.entityLinkScore);
  const confidence = confidenceFor(result);
  const stalePenalty = result.superseded_by ? 0.08 : 0;
  return round(Math.max(0, Math.min(1, score * 0.62 + confidence * 0.26 + entity * 0.12 - stalePenalty)));
}

function confidenceFor(result: RankedResult): number {
  const score = safeScore(result.score);
  const hasSource = Boolean(result.source_file);
  const concepts = Array.isArray(result.concepts) ? result.concepts.length : 0;
  const provenance = Math.min(1, (hasSource ? 0.7 : 0) + Math.min(0.3, concepts * 0.06));
  const stalePenalty = result.superseded_by ? 0.18 : 0;
  return round(Math.max(0, Math.min(1, score * 0.72 + provenance * 0.28 - stalePenalty)));
}

function lacksEvidence(sources: AskSource[]): boolean {
  return sources.length === 0 || Math.max(...sources.map((source) => source.confidence)) < 0.12;
}

function promptFor(question: string, sources: AskSource[]): AskPrompt {
  return {
    instruction: [
      'Answer the question using only the provided sources.',
      'Cite factual claims with bracket citations like [1].',
      'Warn when evidence is stale or superseded.',
      'If sources do not support an answer, set noEvidence=true.',
      'Return JSON only: {"answer":"...","citations":[1],"noEvidence":false}.',
    ].join(' '),
    question,
    sources,
  };
}

function extractiveAnswer(sources: AskSource[], noEvidence: boolean): AskSynthesis {
  const cited = sources.slice(0, 3);
  return { answer: cited.map((source) => `[${source.index}] ${source.excerpt}`).join('\n'), citations: cited.map((source) => source.index), noEvidence, mode: 'extractive' };
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

function titleFrom(sourceFile: string): string {
  const file = sourceFile.split(/[\\/]/).pop() || sourceFile || 'source';
  return file.replace(/\.[^.]+$/, '') || file;
}

function chunkFrom(record: RankedResult): AskSource['chunk'] | undefined {
  const index = numberField(record.chunk_index ?? record.chunkIndex);
  const lineStart = numberField(record.line_start ?? record.lineStart);
  const lineEnd = numberField(record.line_end ?? record.lineEnd);
  return index !== undefined || lineStart !== undefined || lineEnd !== undefined ? { index, lineStart, lineEnd } : undefined;
}

function numberField(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function arrayOfText(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : undefined;
}

function excerpt(content: string): string { return content.replace(/\s+/g, ' ').trim().slice(0, 420); }
function safeScore(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0; }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
