import type { ServerPlugin } from './types.ts';

import { startScoutAnnouncer, type ScoutAnnouncer } from '../../peer/scout-announcer.ts';
import { peerRoutes } from '../../routes/peer/index.ts';

/**
 * maw federation plugin: owns the peer handshake routes plus Scout announcer.
 *
 * Wire contract is defined in src/routes/peer and src/peer/scout-announcer;
 * this module only packages those existing surfaces behind the server plugin
 * lifecycle seam so federation can be plugged in/out without server.ts edits.
 */
export function createFederationPlugin(): ServerPlugin {
  let scoutAnnouncer: ScoutAnnouncer | null = null;

  return {
    name: 'federation',
    tier: 'standard',
    enabled: false,
    seedMenu: false,
    routes: () => peerRoutes,
    start: () => {
      scoutAnnouncer = startScoutAnnouncer();
    },
    stop: () => {
      scoutAnnouncer?.stop();
      scoutAnnouncer = null;
    },
  };
}
