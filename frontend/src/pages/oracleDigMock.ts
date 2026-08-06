export const ORACLE_DIG_CONTRACT = 'GET /api/plugins/oracle-dig?query=&topic=&confidence=&evidenceKind=&dugBy=&since=&until=';
export const EVIDENCE_KINDS = ['github', 'session', 'oracle-msg', 'web'] as const;
export const FINDING_TOPICS = ['schema', 'frontend', 'fleet-log', 'mcp', 'ops'] as const;
export type EvidenceKind = typeof EVIDENCE_KINDS[number];
export type FindingTopic = typeof FINDING_TOPICS[number];
export type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low';

export type OracleFinding = {
  id: string;
  tenantId: string;
  subject: string;
  relation: string | null;
  object: string | null;
  dugBy: string;
  asOfTs: number;
  asOfCommit: string | null;
  confidence: number;
  topic: FindingTopic;
  frictionScore: number | null;
  commissionedBy: string | null;
  iterations: number;
  createdAt: number;
  updatedAt: number;
};

export type OracleEvidence = {
  id: number;
  findingId: string;
  tenantId: string;
  kind: EvidenceKind;
  githubOwner: string | null;
  githubRepo: string | null;
  githubPath: string | null;
  githubRef: string | null;
  githubLine: number | null;
  sessionId: string | null;
  sessionOracle: string | null;
  oracleMsgFrom: string | null;
  oracleMsgAt: number | null;
  webUrl: string | null;
  webFetchedAt: number | null;
  commit: string | null;
  createdAt: number;
};

export type OracleDigFilters = {
  query: string;
  topics: FindingTopic[];
  evidenceKinds: EvidenceKind[];
  confidence: ConfidenceFilter;
  dugBy: string;
  since: string;
  until: string;
};

const at = (value: string) => Date.parse(value);
export const emptyOracleDigFilters: OracleDigFilters = { query: '', topics: [], evidenceKinds: [], confidence: 'all', dugBy: '', since: '', until: '' };

export const mockOracleFindings: OracleFinding[] = [
  {
    id: 'dig_mock_001', tenantId: 'default', subject: 'oracle_dig', relation: 'stores', object: 'typed provenance',
    dugBy: 'metis', asOfTs: at('2026-07-12T02:10:00.000Z'), asOfCommit: 'c8ae41ff', confidence: 0.94,
    topic: 'schema', frictionScore: 0.18, commissionedBy: 'm5:arra-oracle-v3', iterations: 2,
    createdAt: at('2026-07-12T02:12:00.000Z'), updatedAt: at('2026-07-12T02:20:00.000Z'),
  },
  {
    id: 'dig_mock_002', tenantId: 'default', subject: 'Fleet Log console', relation: 'mirrors', object: 'mock-first API contract',
    dugBy: 'frontend', asOfTs: at('2026-07-12T03:05:00.000Z'), asOfCommit: 'f0b3f169', confidence: 0.88,
    topic: 'frontend', frictionScore: 0.24, commissionedBy: 'claude48', iterations: 1,
    createdAt: at('2026-07-12T03:06:00.000Z'), updatedAt: at('2026-07-12T03:08:00.000Z'),
  },
  {
    id: 'dig_mock_003', tenantId: 'default', subject: 'oracle_trace', relation: 'remains separate from', object: 'oracle_dig',
    dugBy: 'oracle', asOfTs: at('2026-07-12T01:30:00.000Z'), asOfCommit: 'alpha', confidence: 0.79,
    topic: 'mcp', frictionScore: 0.42, commissionedBy: 'schema-review', iterations: 3,
    createdAt: at('2026-07-12T01:33:00.000Z'), updatedAt: at('2026-07-12T01:40:00.000Z'),
  },
  {
    id: 'dig_mock_004', tenantId: 'default', subject: 'silent maw agents', relation: 'need', object: 'phase-5 git-log ingestion evidence',
    dugBy: 'digger', asOfTs: at('2026-07-11T22:37:29.000Z'), asOfCommit: null, confidence: 0.63,
    topic: 'ops', frictionScore: 0.61, commissionedBy: 'ops-room', iterations: 1,
    createdAt: at('2026-07-11T22:38:00.000Z'), updatedAt: at('2026-07-11T22:45:00.000Z'),
  },
  {
    id: 'dig_mock_005', tenantId: 'default', subject: 'fleet_messages', relation: 'connects to', object: 'oracle_dig evidence browse',
    dugBy: 'm5:arra-oracle-v3', asOfTs: at('2026-07-12T04:00:00.000Z'), asOfCommit: 'alpha', confidence: 0.72,
    topic: 'fleet-log', frictionScore: 0.31, commissionedBy: 'phase5', iterations: 1,
    createdAt: at('2026-07-12T04:02:00.000Z'), updatedAt: at('2026-07-12T04:04:00.000Z'),
  },
];

export const mockOracleEvidence: OracleEvidence[] = [
  { id: 1, findingId: 'dig_mock_001', tenantId: 'default', kind: 'github', githubOwner: 'Soul-Brews-Studio', githubRepo: 'arra-oracle-v3', githubPath: 'src/db/oracle-dig-schema.ts', githubRef: 'alpha', githubLine: 3, sessionId: null, sessionOracle: null, oracleMsgFrom: null, oracleMsgAt: null, webUrl: null, webFetchedAt: null, commit: 'c8ae41ff', createdAt: at('2026-07-12T02:12:30.000Z') },
  { id: 2, findingId: 'dig_mock_001', tenantId: 'default', kind: 'web', githubOwner: null, githubRepo: null, githubPath: null, githubRef: null, githubLine: null, sessionId: null, sessionOracle: null, oracleMsgFrom: null, oracleMsgAt: null, webUrl: 'https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2770', webFetchedAt: at('2026-07-12T02:13:00.000Z'), commit: null, createdAt: at('2026-07-12T02:13:00.000Z') },
  { id: 3, findingId: 'dig_mock_002', tenantId: 'default', kind: 'github', githubOwner: 'Soul-Brews-Studio', githubRepo: 'arra-oracle-v3', githubPath: 'frontend/src/pages/FleetLogPage.tsx', githubRef: 'feat/2765-fleet-log-console', githubLine: 1, sessionId: null, sessionOracle: null, oracleMsgFrom: null, oracleMsgAt: null, webUrl: null, webFetchedAt: null, commit: 'f0b3f169', createdAt: at('2026-07-12T03:07:00.000Z') },
  { id: 4, findingId: 'dig_mock_002', tenantId: 'default', kind: 'session', githubOwner: null, githubRepo: null, githubPath: null, githubRef: null, githubLine: null, sessionId: 'omx-1783774150868-dsg7ho', sessionOracle: 'm5:arra-oracle-v3', oracleMsgFrom: null, oracleMsgAt: null, webUrl: null, webFetchedAt: null, commit: null, createdAt: at('2026-07-12T03:08:00.000Z') },
  { id: 5, findingId: 'dig_mock_003', tenantId: 'default', kind: 'github', githubOwner: 'Soul-Brews-Studio', githubRepo: 'arra-oracle-v3', githubPath: 'docs/decisions/oracle-dig-provenance-schema.md', githubRef: 'alpha', githubLine: 26, sessionId: null, sessionOracle: null, oracleMsgFrom: null, oracleMsgAt: null, webUrl: null, webFetchedAt: null, commit: 'alpha', createdAt: at('2026-07-12T01:35:00.000Z') },
  { id: 6, findingId: 'dig_mock_004', tenantId: 'default', kind: 'oracle-msg', githubOwner: null, githubRepo: null, githubPath: null, githubRef: null, githubLine: null, sessionId: null, sessionOracle: null, oracleMsgFrom: 'discord:ops-room', oracleMsgAt: at('2026-07-11T22:37:29.000Z'), webUrl: null, webFetchedAt: null, commit: null, createdAt: at('2026-07-11T22:38:00.000Z') },
  { id: 7, findingId: 'dig_mock_005', tenantId: 'default', kind: 'github', githubOwner: 'Soul-Brews-Studio', githubRepo: 'arra-oracle-v3', githubPath: 'frontend/src/pages/fleetLogMock.ts', githubRef: 'alpha', githubLine: 1, sessionId: null, sessionOracle: null, oracleMsgFrom: null, oracleMsgAt: null, webUrl: null, webFetchedAt: null, commit: 'alpha', createdAt: at('2026-07-12T04:03:00.000Z') },
];

function includes(value: string | null | undefined, query: string): boolean {
  return value?.toLowerCase().includes(query.toLowerCase()) ?? false;
}

function confidenceBand(value: number): Exclude<ConfidenceFilter, 'all'> {
  if (value >= 0.85) return 'high';
  if (value >= 0.7) return 'medium';
  return 'low';
}

function afterDate(ts: number, since: string): boolean {
  return !since || ts >= new Date(`${since}T00:00:00`).getTime();
}

function beforeDate(ts: number, until: string): boolean {
  return !until || ts <= new Date(`${until}T23:59:59.999`).getTime();
}

export function evidenceForFinding(findingId: string): OracleEvidence[] {
  return mockOracleEvidence.filter((item) => item.findingId === findingId);
}

export function searchMockOracleFindings(filters: OracleDigFilters): OracleFinding[] {
  const q = filters.query.trim();
  const dugBy = filters.dugBy.trim().toLowerCase();
  return mockOracleFindings
    .filter((finding) => !filters.topics.length || filters.topics.includes(finding.topic))
    .filter((finding) => filters.confidence === 'all' || confidenceBand(finding.confidence) === filters.confidence)
    .filter((finding) => !dugBy || includes(finding.dugBy, dugBy))
    .filter((finding) => afterDate(finding.asOfTs, filters.since) && beforeDate(finding.asOfTs, filters.until))
    .filter((finding) => !filters.evidenceKinds.length || evidenceForFinding(finding.id).some((item) => filters.evidenceKinds.includes(item.kind)))
    .filter((finding) => !q || [finding.subject, finding.relation, finding.object, finding.topic, finding.dugBy]
      .some((value) => includes(value, q)) || evidenceForFinding(finding.id).some((item) => [item.githubPath, item.sessionId, item.oracleMsgFrom, item.webUrl].some((value) => includes(value, q))))
    .sort((left, right) => right.asOfTs - left.asOfTs);
}
