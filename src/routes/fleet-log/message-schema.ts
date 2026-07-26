/**
 * The wire shape of a fleet message, matching `FleetMessage` in
 * `frontend/src/pages/fleetLogMock.ts` field for field — the mock is the contract, and the
 * frontend swaps its fixture for a real fetch without changing its types.
 */
import { t } from 'elysia';

export function fleetMessageSchema() {
  return t.Object({
    id: t.String(),
    tenantId: t.String(),
    channel: t.String(),
    source: t.Nullable(t.String()),
    direction: t.Nullable(t.String()),
    fromId: t.Nullable(t.String()),
    toId: t.Nullable(t.String()),
    threadKey: t.Nullable(t.String()),
    text: t.Nullable(t.String()),
    raw: t.Nullable(t.String()),
    rawPath: t.Nullable(t.String()),
    ts: t.Number(),
    ingestedAt: t.Number(),
  });
}
