/** What the Topology drawing's colours and line styles mean, in plain words (#3110 hallmark pass). */

import { EXPORT, STATE, STRANGER } from './topology-words';

function Swatch({ stroke, dash, arrow = false }: { stroke: string; dash?: string; arrow?: boolean }) {
  return (
    <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden className="shrink-0">
      <line x1="2" y1="7" x2={arrow ? 26 : 32} y2="7" stroke={stroke} strokeWidth="2.5" strokeDasharray={dash} />
      {arrow && <path d="M25,2 L33,7 L25,12 z" fill={stroke} />}
    </svg>
  );
}

const ROWS: Array<{ stroke: string; dash?: string; arrow?: boolean; word: string; means: string }> = [
  { stroke: STATE.active.stroke, word: 'Active', means: 'can search and share notes' },
  { stroke: STATE.expired.stroke, dash: STATE.expired.dash, word: 'Expired', means: 'its invite time ran out' },
  { stroke: STATE.revoked.stroke, dash: STATE.revoked.dash, word: 'Revoked', means: 'cut off by you, the owner' },
  { stroke: STRANGER.stroke, dash: STRANGER.dash, word: 'Strangers', means: 'tried to get in without a valid invite' },
  { stroke: EXPORT, arrow: true, word: 'Arrow', means: 'one way only: the vault feeds the hub, the hub exports to Ossie, nothing comes back' },
];

export function TopologyLegend() {
  return (
    <div data-testid="topology-legend" className="mt-4 grid gap-x-8 gap-y-2 border-t border-gray-800 pt-4 text-sm text-gray-300 md:grid-cols-2">
      {ROWS.map((r) => (
        <div key={r.word} className="flex items-start gap-3">
          <span className="pt-1"><Swatch stroke={r.stroke} dash={r.dash} arrow={r.arrow} /></span>
          <span><span className="font-medium text-gray-100">{r.word}</span>: {r.means}</span>
        </div>
      ))}
      <div data-box="private" className="flex items-start gap-3">
        <span className="pt-1"><Swatch stroke="#64748b" dash="4 4" /></span>
        <span><span className="font-medium text-gray-100">Private notes</span> stay on each machine. Only notes a machine chooses to share reach the hub vault.</span>
      </div>
      <p className="text-gray-400 md:col-span-2">
        A machine gets in with its own key, and only from the tailnet or the local network. Tap a machine for its details, or to revoke it.
      </p>
    </div>
  );
}
