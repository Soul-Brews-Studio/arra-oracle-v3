import { db, x402RequestLog } from '../../db/index.ts';
import { tenantIdForWrite } from '../../middleware/tenant.ts';

export type X402LogEntry = {
  route: string;
  status: 'unpaid' | 'rejected' | 'handler_failed' | 'settlement_failed' | 'settled';
  network?: string;
  asset?: string;
  amount?: string;
  payer?: string;
  transaction?: string;
  errorReason?: string;
  project?: string;
};

/** Records one x402-gated request outcome. Never throws — logging must not break the request. */
export function logX402Request(entry: X402LogEntry): void {
  try {
    db.insert(x402RequestLog).values({
      route: entry.route,
      status: entry.status,
      network: entry.network ?? null,
      asset: entry.asset ?? null,
      amount: entry.amount ?? null,
      payer: entry.payer ?? null,
      transaction: entry.transaction ?? null,
      errorReason: entry.errorReason ?? null,
      createdAt: Date.now(),
      tenantId: tenantIdForWrite(),
      project: entry.project ?? null,
    }).run();
  } catch (e) {
    console.error('Failed to log x402 request:', e);
  }
}
