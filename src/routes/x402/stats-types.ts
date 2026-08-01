// Pure type exports for GET /api/x402/stats, kept dependency-free (no `db`/bun:sqlite
// imports) so the frontend can import these types without pulling the storage layer
// into its own tsc pass — mirrors src/server/types.ts, which MetricsSnapshot lives in.

export type X402Status = 'unpaid' | 'rejected' | 'handler_failed' | 'settlement_failed' | 'settled';

export type X402StatsRecentEntry = {
  id: number;
  route: string;
  status: X402Status;
  network: string | null;
  asset: string | null;
  amount: string | null;
  payer: string | null;
  transaction: string | null;
  errorReason: string | null;
  createdAt: number; // epoch ms, Date.now() per logging.ts
};

export type X402StatsResponse = {
  totals: {
    requests: number;
    settled: number;
    rejected: number;
    unpaid: number;
    failed: number;
    revenueAtomic: string;
    revenueApprox: number;
  };
  recent: X402StatsRecentEntry[];
};
