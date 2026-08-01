import { Elysia } from 'elysia';
import { answerOracleAsk, type AskInput } from '../ask/index.ts';
import { AskBody } from '../ask/model.ts';
import { ElysiaAdapter } from './adapter.ts';
import { logX402Request } from './logging.ts';
import {
  createPaidAskHTTPServer,
  loadX402ConfigFromEnv,
  type PaidAskServerDeps,
} from './resource-server.ts';

const ROUTE_PATH = '/api/x402/ask';

type AskDeps = Parameters<typeof answerOracleAsk>[1];
export type PaidAskRouteDeps = { x402?: PaidAskServerDeps; ask?: AskDeps };

/**
 * Paid twin of POST /api/ask, gated by an x402 HTTP-402 payment (see docs/x402.md).
 * Returns a no-op Elysia app when X402_PAYOUT_ADDRESS is unset, so the server boots
 * normally on deployments that haven't opted into monetization yet.
 */
export function createPaidAskRoutes(deps: PaidAskRouteDeps = {}) {
  const config = deps.x402?.config ?? loadX402ConfigFromEnv();
  if (!config) return new Elysia({ prefix: '/api' });

  const httpServer = createPaidAskHTTPServer({
    config,
    facilitatorClients: deps.x402?.facilitatorClients,
  });
  let initialized: Promise<void> | null = null;

  return new Elysia({ prefix: '/api' }).post(
    '/x402/ask',
    async ({ request, headers, query, body, set }) => {
      if (!initialized) initialized = httpServer.initialize();
      try {
        await initialized;
      } catch {
        initialized = null;
        set.status = 502;
        return { error: 'x402 facilitator unavailable' };
      }

      const adapter = new ElysiaAdapter({ request, headers, path: ROUTE_PATH, query });
      const context = { adapter, path: ROUTE_PATH, method: 'POST' };
      const hadPayment = !!adapter.getHeader('payment-signature');
      const result = await httpServer.processHTTPRequest(context);

      if (result.type === 'payment-error') {
        logX402Request({ route: ROUTE_PATH, status: hadPayment ? 'rejected' : 'unpaid' });
        set.status = result.response.status;
        Object.assign(set.headers, result.response.headers);
        return result.response.body ?? {};
      }

      if (result.type === 'no-payment-required') {
        const askResult = await answerOracleAsk(body as AskInput, deps.ask ?? {});
        set.status = askResult.status;
        return askResult.body;
      }

      const { cancellationDispatcher, paymentPayload, paymentRequirements, declaredExtensions } =
        result;
      let askResult: Awaited<ReturnType<typeof answerOracleAsk>>;
      try {
        askResult = await answerOracleAsk(body as AskInput, deps.ask ?? {});
      } catch (error) {
        await cancellationDispatcher.cancel({ reason: 'handler_threw', error });
        throw error;
      }

      if (askResult.status >= 400) {
        await cancellationDispatcher.cancel({
          reason: 'handler_failed',
          responseStatus: askResult.status,
        });
        logX402Request({
          route: ROUTE_PATH,
          status: 'handler_failed',
          network: paymentRequirements.network,
          asset: paymentRequirements.asset,
          amount: paymentRequirements.amount,
        });
        set.status = askResult.status;
        return askResult.body;
      }

      const settleResult = await httpServer.processSettlement(
        paymentPayload,
        paymentRequirements,
        declaredExtensions,
        { request: context },
      );

      if (!settleResult.success) {
        logX402Request({
          route: ROUTE_PATH,
          status: 'settlement_failed',
          network: paymentRequirements.network,
          asset: paymentRequirements.asset,
          amount: paymentRequirements.amount,
          errorReason: settleResult.errorReason,
        });
        set.status = settleResult.response.status;
        Object.assign(set.headers, settleResult.response.headers);
        return settleResult.response.body ?? {};
      }

      logX402Request({
        route: ROUTE_PATH,
        status: 'settled',
        network: paymentRequirements.network,
        asset: paymentRequirements.asset,
        amount: settleResult.amount ?? paymentRequirements.amount,
        payer: settleResult.payer,
        transaction: settleResult.transaction,
      });
      Object.assign(set.headers, settleResult.headers);
      set.status = askResult.status;
      return askResult.body;
    },
    {
      body: AskBody,
      detail: {
        tags: ['ask', 'x402'],
        summary: 'Paid version of /api/ask, gated by an x402 HTTP 402 payment',
      },
    },
  );
}

export const paidAskRoutes = createPaidAskRoutes();
