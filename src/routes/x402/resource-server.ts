import { ExactEvmScheme } from '@x402/evm/exact/server';
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
} from '@x402/core/server';
import type { Network } from '@x402/core/types';
import type { RouteConfig } from '@x402/core/server';

export type X402Config = {
  payoutAddress: string;
  network: Network;
  price: string;
  facilitatorUrl: string;
};

export function loadX402ConfigFromEnv(): X402Config | undefined {
  const payoutAddress = process.env.X402_PAYOUT_ADDRESS;
  if (!payoutAddress) return undefined;
  return {
    payoutAddress,
    network: (process.env.X402_NETWORK ?? 'eip155:84532') as Network,
    price: process.env.X402_PRICE ?? '0.01',
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator',
  };
}

export type PaidAskServerDeps = {
  config: X402Config;
  facilitatorClients?: FacilitatorClient[];
};

/**
 * Builds the x402 protocol gate for the paid `/api/x402/ask` route.
 * `facilitatorClients` is injectable so tests can supply a fake facilitator instead of
 * hitting a real one (mirrors the `deps` pattern used by `createAskRoutes`).
 */
export function createPaidAskHTTPServer(deps: PaidAskServerDeps): x402HTTPResourceServer {
  const { config } = deps;
  const facilitatorClients = deps.facilitatorClients ?? [
    new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  ];

  const resourceServer = new x402ResourceServer(facilitatorClients);
  resourceServer.register(config.network, new ExactEvmScheme());

  const routes: Record<string, RouteConfig> = {
    'POST /api/x402/ask': {
      accepts: {
        scheme: 'exact',
        network: config.network,
        price: config.price,
        payTo: config.payoutAddress,
      },
      description: 'Ask the oracle with cited synthesis over hybrid/vector search (paid)',
    },
  };

  return new x402HTTPResourceServer(resourceServer, routes);
}
