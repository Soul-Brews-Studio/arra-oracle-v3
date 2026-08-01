import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  type FacilitatorClient,
} from '@x402/core/http';
import type { PaymentPayload, SettleResponse, VerifyResponse } from '@x402/core/types';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-x402-ask-'));
const NETWORK = 'eip155:84532';
const PAYOUT_ADDRESS = '0x1111111111111111111111111111111111111111';

let dbModule: typeof import('../../../src/db/index.ts');
let createPaidAskRoutes: typeof import('../../../src/routes/x402/index.ts').createPaidAskRoutes;
let route: { handle: (request: Request) => Response | Promise<Response> };
let verifyResult: VerifyResponse = { isValid: true };
let settleResult: SettleResponse = { success: true, transaction: '0xtest', network: NETWORK };

const fakeFacilitator: FacilitatorClient = {
  async getSupported() {
    return { kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }], extensions: [], signers: {} };
  },
  async verify() {
    return verifyResult;
  },
  async settle() {
    return settleResult;
  },
};

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  ({ createPaidAskRoutes } = await import('../../../src/routes/x402/index.ts'));

  route = createPaidAskRoutes({
    x402: {
      config: { payoutAddress: PAYOUT_ADDRESS, network: NETWORK, price: '$0.01', facilitatorUrl: 'unused' },
      facilitatorClients: [fakeFacilitator],
    },
    ask: { now: () => new Date('2026-08-01T00:00:00.000Z') },
  });
});

afterAll(() => {
  dbModule?.closeDb();
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true });
});

function post(headers: Record<string, string> = {}) {
  return route.handle(new Request('http://local/api/x402/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify({ question: 'x402 gate test', llm: false }),
  }));
}

async function paidHeader(): Promise<string> {
  const unpaid = await post();
  const encoded = unpaid.headers.get('PAYMENT-REQUIRED');
  if (!encoded) throw new Error('expected PAYMENT-REQUIRED header on unpaid response');
  const paymentRequired = decodePaymentRequiredHeader(encoded);
  const accepted = paymentRequired.accepts[0];
  const payload: PaymentPayload = { x402Version: 2, accepted, payload: {} };
  return encodePaymentSignatureHeader(payload);
}

describe('POST /api/x402/ask payment gate', () => {
  test('rejects requests with no payment header', async () => {
    const res = await post();
    expect(res.status).toBe(402);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    const body = await res.json();
    expect(body).not.toHaveProperty('answer');
  });

  test('rejects a payment the facilitator marks invalid', async () => {
    verifyResult = { isValid: false, invalidReason: 'invalid_signature' };
    try {
      const header = await paidHeader();
      const res = await post({ 'payment-signature': header });
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body).not.toHaveProperty('answer');
    } finally {
      verifyResult = { isValid: true };
    }
  });

  test('serves the ask response and settles payment once verified', async () => {
    const header = await paidHeader();
    const res = await post({ 'payment-signature': header });
    expect(res.status).toBe(200);
    expect(res.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ query: 'x402 gate test' });
  });
});
