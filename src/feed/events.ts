export interface FeedEvent {
  timestamp: string;
  oracle: string;
  host: string;
  event: string;
  project: string;
  session_id: string;
  message: string;
  tenant_id?: string;
  source: 'local' | 'maw-js';
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const FIELD_SEPARATOR = ' | ';
const MESSAGE_SEPARATOR = ' » ';

export function normalizeFeedLimit(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(normalized)) return DEFAULT_LIMIT;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function compactLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function cleanField(value: unknown): string {
  if (typeof value !== 'string') return '';
  return compactLine(value).replaceAll(FIELD_SEPARATOR, ' ').replaceAll(MESSAGE_SEPARATOR, ' ');
}

function cleanMessage(value: unknown): string {
  return typeof value === 'string' ? compactLine(value) : '';
}

function requiredField(value: unknown, label: string): string {
  const field = cleanField(value);
  if (!field) throw new Error(`${label} is required`);
  return field;
}

export function formatLocalFeedLine(input: {
  timestamp: string;
  tenantId: string;
  oracle: unknown;
  host: string;
  event: unknown;
  project?: unknown;
  sessionId?: unknown;
  message?: unknown;
}): string {
  const fields = [
    requiredField(input.timestamp, 'timestamp'),
    requiredField(input.tenantId, 'tenantId'),
    requiredField(input.oracle, 'oracle'),
    requiredField(input.host, 'host'),
    requiredField(input.event, 'event'),
    cleanField(input.project),
    cleanField(input.sessionId),
  ];
  return `${fields.join(FIELD_SEPARATOR)}${MESSAGE_SEPARATOR}${cleanMessage(input.message)}\n`;
}

export function parseLocalEvent(line: string, fallbackTenantId?: string): FeedEvent | undefined {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) return undefined;
  const [head, ...messageParts] = trimmed.split(MESSAGE_SEPARATOR);
  const fields = head.split(FIELD_SEPARATOR).map((s) => s.trim());
  const hasTenant = fields.length >= 7;
  if ((!hasTenant && fields.length < 6) || (hasTenant && fields.length < 7)) return undefined;
  const [ts, tenantOrOracle, oracleOrHost, hostOrEvent, eventOrProject, projectOrSession] = fields;
  const tenantId = hasTenant ? tenantOrOracle || fallbackTenantId : fallbackTenantId;
  const oracle = hasTenant ? oracleOrHost : tenantOrOracle;
  const event = hasTenant ? eventOrProject : hostOrEvent;
  if (!ts || !oracle || !event) return undefined;
  return {
    timestamp: ts,
    tenant_id: tenantId,
    oracle,
    host: hasTenant ? hostOrEvent : oracleOrHost,
    event,
    project: hasTenant ? projectOrSession : eventOrProject,
    session_id: (hasTenant ? fields.slice(6) : fields.slice(5)).join(FIELD_SEPARATOR).trim(),
    message: messageParts.join(MESSAGE_SEPARATOR).trim(),
    source: 'local',
  };
}

function valueString(value: unknown): string {
  return typeof value === 'string' ? compactLine(value) : '';
}

function tenantForEvent(event: unknown): string | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const raw = event as Record<string, unknown>;
  return valueString(raw.tenant_id ?? raw.tenantId ?? raw.tenant) || undefined;
}

function remoteTimestamp(event: Record<string, unknown>): string {
  const timestamp = valueString(event.timestamp);
  if (timestamp) return timestamp;
  const date = new Date(valueString(event.ts));
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().replace('T', ' ').slice(0, 19)
    : date.toISOString().replace('T', ' ').slice(0, 19);
}

export function parseMawEvent(event: unknown): FeedEvent | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const raw = event as Record<string, unknown>;
  const oracle = valueString(raw.oracle);
  const type = valueString(raw.event);
  if (!oracle || !type) return undefined;
  return {
    timestamp: remoteTimestamp(raw),
    tenant_id: tenantForEvent(raw),
    oracle,
    host: valueString(raw.host),
    event: type,
    project: valueString(raw.project),
    session_id: valueString(raw.sessionId ?? raw.session_id),
    message: valueString(raw.message),
    source: 'maw-js',
  };
}

export function feedTimestampMs(event: FeedEvent): number {
  const ms = new Date(event.timestamp).getTime();
  return Number.isFinite(ms) ? ms : 0;
}
