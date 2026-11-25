/**
 * Plain words for the Topology drawing (#3110 hallmark pass): what a person reads at a glance.
 * The codes (401, 403, Bearer, ψ/) stay out of the drawing; the node panel and the docs carry them.
 */

import type { OssieStatus, Topology, TopologyNode } from './topology-api';
import { ago } from './format';

export const STATE = {
  active: { stroke: 'var(--color-ok-text)', fill: 'var(--color-ok-bg)', text: 'var(--color-ok-text)', dash: undefined, word: 'Active' },
  expired: { stroke: 'var(--color-warn-text)', fill: 'var(--color-warn-bg)', text: 'var(--color-warn-text)', dash: '7 5', word: 'Expired' },
  revoked: { stroke: 'var(--color-err-text)', fill: 'var(--color-err-bg)', text: 'var(--color-err-text)', dash: '7 5', word: 'Revoked' },
} as const;
export const STRANGER = { stroke: 'var(--color-err-text)', dash: '2 5', text: 'var(--color-err-text)' } as const;
export const EXPORT = 'var(--color-accent2)';

export const stateOf = (n: TopologyNode) => STATE[n.state] ?? STATE.revoked;

/** "Active, 7d left" · "Expired 2h ago" · "Revoked 3m ago". */
export function statusLine(n: TopologyNode): string {
  if (n.state === 'revoked') return `Revoked ${ago(n.revokedAt)}`;
  if (n.state === 'expired') return `Expired ${ago(n.expiresAt)}`;
  return n.expiresAt ? `Active, ${n.left}` : 'Active, no end date';
}

/** Third line: refusals win, because they are what the owner should notice. */
export function activityLine(n: TopologyNode): { text: string; alert: boolean } {
  if (n.refused.count) return { text: `turned away ${n.refused.count} time${n.refused.count === 1 ? '' : 's'}`, alert: true };
  return { text: `seen ${ago(n.lastSeenAt)} · ${n.calls} calls`, alert: false };
}

export function strangerLines(d: Topology['door']): string[] {
  const outside = d.outside.count ? ` · ${d.outside.count} off-network` : '';
  return [`${d.strangers.count} turned away${outside}`, d.strangers.lastAt ? `last ${ago(d.strangers.lastAt)}` : 'none yet'];
}

/** Ossie box second line + its colour. */
export function ossieLine(o: OssieStatus): { text: string; colour: string } {
  if (!o.check.ok) return { text: `${o.check.errors.length} problems found`, colour: STATE.revoked.text };
  if (!o.official) return { text: 'validator not run yet', colour: STATE.expired.text };
  if (!o.official.passed) return { text: 'validator failed', colour: STATE.revoked.text };
  if (!o.official.current) return { text: 'passed, older export', colour: STATE.expired.text };
  return { text: `validator passed ${ago(o.official.at)}`, colour: STATE.active.text };
}
