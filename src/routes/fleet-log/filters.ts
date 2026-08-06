/**
 * Query-parameter parsing for the Fleet Log read routes (#2879).
 *
 * The contract is not invented here — `frontend/src/pages/fleetLogMock.ts` already declares it:
 *
 *   GET /api/fleet-log/search?query=&channel=&from=&to=&since=&until=
 *
 * and `FleetLogFilters` shows what those names mean. `from`/`to` are **sender and recipient**
 * (`from_id` / `to_id`), not a time range — `since`/`until` are the window. Reading them as a
 * date range would have produced an endpoint that matched the string and not the intent.
 *
 * **Unknown filter values are a 400, never a silent pass-through.** A filter that quietly
 * matches everything when it does not understand its input is the defect shape this repo spent
 * the night removing: a stage does nothing while the pipeline reports success (#2857, #2863,
 * #2877, #2880). A typo'd channel returning the whole corpus looks exactly like a working
 * search.
 */
import { and, eq, gte, inArray, like, lte, type SQL } from 'drizzle-orm';
import { fleetMessages } from '../../db/fleet-log-schema.ts';

/** Mirrors FLEET_CHANNELS in frontend/src/pages/fleetLogMock.ts. */
export const FLEET_CHANNELS = ['maw', 'vault', 'webhook', 'discord', 'agent-team', 'git'] as const;
export type FleetChannel = typeof FLEET_CHANNELS[number];

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export class FleetFilterError extends Error {}

export interface FleetSearchQuery {
  query?: string;
  channel?: string;
  from?: string;
  to?: string;
  since?: string;
  until?: string;
  limit?: string;
  offset?: string;
}

/** Accepts epoch milliseconds or anything `Date` parses, including the `YYYY-MM-DD` a date input sends. */
export function parseTimestamp(raw: string, field: string): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new FleetFilterError(`${field} must be epoch milliseconds or a parseable date, got "${raw}"`);
  }
  return parsed;
}

/** Comma-separated, because the frontend holds `channels: FleetChannel[]`. */
export function parseChannels(raw: string): FleetChannel[] {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const unknown = parts.filter((p) => !FLEET_CHANNELS.includes(p as FleetChannel));
  if (unknown.length > 0) {
    throw new FleetFilterError(
      `unknown channel(s): ${unknown.join(', ')}. Known channels: ${FLEET_CHANNELS.join(', ')}`,
    );
  }
  return parts as FleetChannel[];
}

export function parsePagination(query: FleetSearchQuery): { limit: number; offset: number } {
  const limitRaw = query.limit?.trim();
  const offsetRaw = query.offset?.trim();
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
  const offset = offsetRaw ? Number(offsetRaw) : 0;
  if (!Number.isInteger(limit) || limit < 1) throw new FleetFilterError(`limit must be a positive integer, got "${limitRaw}"`);
  if (!Number.isInteger(offset) || offset < 0) throw new FleetFilterError(`offset must be a non-negative integer, got "${offsetRaw}"`);
  // Capped rather than rejected: a client asking for too much gets the most it may have.
  return { limit: Math.min(limit, MAX_LIMIT), offset };
}

/** `%` and `_` are LIKE wildcards; a user searching for "100%" means the literal characters. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Build the WHERE clause. `tenantId` is always applied — it is not optional and not derived
 * from user input, so one tenant can never read another's messages.
 */
export function buildFleetWhere(tenantId: string, query: FleetSearchQuery): SQL | undefined {
  const conditions: SQL[] = [eq(fleetMessages.tenantId, tenantId)];

  const text = query.query?.trim();
  if (text) conditions.push(like(fleetMessages.text, `%${escapeLikePattern(text)}%`));

  const channels = query.channel?.trim() ? parseChannels(query.channel) : [];
  if (channels.length > 0) conditions.push(inArray(fleetMessages.channel, channels));

  const from = query.from?.trim();
  if (from) conditions.push(eq(fleetMessages.fromId, from));
  const to = query.to?.trim();
  if (to) conditions.push(eq(fleetMessages.toId, to));

  const since = query.since?.trim();
  if (since) conditions.push(gte(fleetMessages.ts, parseTimestamp(since, 'since')));
  const until = query.until?.trim();
  if (until) conditions.push(lte(fleetMessages.ts, parseTimestamp(until, 'until')));

  return and(...conditions);
}
