import { handleTrace, handleTraceList } from '../../tools/trace.ts';
import type { ToolResponse } from '../../tools/types.ts';
import type { CreateTraceInput, FoundFile, FoundIssue, ListTracesInput } from '../../trace/types.ts';
import type { oracleFindingEvidence } from '../../db/oracle-dig-schema.ts';

export type OracleFindingEvidenceInsert = typeof oracleFindingEvidence.$inferInsert;

type JsonObject = Record<string, unknown>;

interface RepoRef {
  owner?: string;
  repo?: string;
}

interface FileRef extends RepoRef {
  path?: string;
  ref?: string;
  line?: number;
}

export interface TraceBridgeInput {
  findingId: string;
  trace: CreateTraceInput;
  tenantId?: string;
  asOfCommit?: string;
  createdAt?: number;
  listInput?: ListTracesInput;
}

export interface TraceBridgeHandlers {
  handleTrace: typeof handleTrace;
  handleTraceList: typeof handleTraceList;
}

export interface TraceBridgeResult {
  traceId?: string;
  trace: JsonObject;
  traceList: JsonObject;
  evidenceRows: OracleFindingEvidenceInsert[];
}

export const defaultTraceBridgeHandlers: TraceBridgeHandlers = { handleTrace, handleTraceList };

export async function bridgeTraceToGithubEvidence(
  input: TraceBridgeInput,
  handlers: TraceBridgeHandlers = defaultTraceBridgeHandlers,
): Promise<TraceBridgeResult> {
  const traceResponse = await handlers.handleTrace(input.trace);
  const tracePayload = parseToolJson(traceResponse);
  if (traceResponse.isError || tracePayload.success === false) {
    throw new Error(`oracle_trace failed: ${JSON.stringify(tracePayload)}`);
  }

  const listResponse = await handlers.handleTraceList(input.listInput ?? {
    limit: 20,
    project: input.trace.project,
    query: input.trace.query,
  });
  const traceList = parseToolJson(listResponse);

  return {
    traceId: stringValue(tracePayload.trace_id),
    trace: tracePayload,
    traceList,
    // handleTrace stores, but does not echo, dig points; derive evidence from
    // the exact found* payload sent to the direct core call above.
    evidenceRows: mapTraceGithubEvidence(input),
  };
}

export function mapTraceGithubEvidence(input: TraceBridgeInput): OracleFindingEvidenceInsert[] {
  const tenantId = input.tenantId ?? 'default';
  const createdAt = input.createdAt ?? Date.now();
  const baseRepo = parseRepoRef(input.trace.project);
  const common = { findingId: input.findingId, tenantId, kind: 'github' as const, createdAt };
  const rows: OracleFindingEvidenceInsert[] = [];

  for (const file of input.trace.foundFiles ?? []) {
    const fileRef = parseFileRef(file, baseRepo);
    rows.push({
      ...common,
      githubOwner: fileRef.owner,
      githubRepo: fileRef.repo,
      githubPath: fileRef.path,
      githubRef: input.asOfCommit ?? fileRef.ref,
      githubLine: fileRef.line,
      commit: input.asOfCommit,
    });
  }

  for (const commit of input.trace.foundCommits ?? []) {
    rows.push({
      ...common,
      githubOwner: baseRepo.owner,
      githubRepo: baseRepo.repo,
      githubRef: commit.hash || commit.shortHash,
      commit: commit.hash || commit.shortHash,
    });
  }

  for (const issue of input.trace.foundIssues ?? []) {
    const issueRepo = parseIssueRepo(issue) ?? baseRepo;
    rows.push({
      ...common,
      githubOwner: issueRepo.owner,
      githubRepo: issueRepo.repo,
      githubPath: `issues/${issue.number}`,
      githubRef: `#${issue.number}`,
      commit: input.asOfCommit,
    });
  }

  return rows;
}

function parseToolJson(response: ToolResponse): JsonObject {
  const text = response.content.find((part) => part.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : { value: parsed };
}

function parseFileRef(file: FoundFile, baseRepo: RepoRef): FileRef {
  let raw = file.path.trim();
  let line: number | undefined;
  const hashLine = raw.match(/#L(\d+)$/i);
  const colonLine = raw.match(/:(\d+)$/);
  if (hashLine) {
    line = Number(hashLine[1]);
    raw = raw.slice(0, -hashLine[0].length);
  } else if (colonLine) {
    line = Number(colonLine[1]);
    raw = raw.slice(0, -colonLine[0].length);
  }

  const embedded = parseRepoPath(raw);
  return {
    owner: embedded.owner ?? baseRepo.owner,
    repo: embedded.repo ?? baseRepo.repo,
    path: embedded.path ?? raw,
    ref: embedded.ref,
    line,
  };
}

function parseIssueRepo(issue: FoundIssue): RepoRef | undefined {
  if (!issue.url) return undefined;
  const match = issue.url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/\d+/i);
  if (!match) return undefined;
  return { owner: match[1], repo: trimGit(match[2]) };
}

function parseRepoPath(value: string): FileRef {
  const clean = value.replace(/^https?:\/\//, '');
  if (!clean.startsWith('github.com/')) return {};
  const parts = clean.replace(/^github\.com\//, '').split('/').filter(Boolean);
  if (parts.length < 3) return {};
  if ((parts[2] === 'blob' || parts[2] === 'tree') && parts.length >= 5) {
    return { owner: parts[0], repo: trimGit(parts[1]), ref: parts[3], path: parts.slice(4).join('/') };
  }
  return { owner: parts[0], repo: trimGit(parts[1]), path: parts.slice(2).join('/') };
}

function parseRepoRef(value?: string): RepoRef {
  if (!value) return {};
  const clean = value.replace(/^https?:\/\//, '').replace(/^github\.com\//, '').replace(/\.git$/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length < 2) return {};
  return { owner: parts.at(-2), repo: trimGit(parts.at(-1) ?? '') };
}

function trimGit(value: string): string {
  return value.replace(/\.git$/, '');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
