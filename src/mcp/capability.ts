/**
 * Server capability report — the trusted, server-computed field the birth
 * canary corroborates against the live catalog (birth spec v5 D4). A model's
 * final text is never acceptance evidence; this report is set once by the
 * server constructor from its own resolved state, so a probe reading it gets
 * the process truth, not a claim.
 */

export type ServerCapabilityReport = {
  profile: 'read-mostly' | 'delegate' | 'owner';
  readOnly: boolean;
  /** Owner-core proxy granted to remoteWriteSafe tools; null = no write lane. */
  remoteWriteApiBase: string | null;
  /** Full HTTP-proxy base; null = embedded reads. */
  oracleApiBase: string | null;
  /** Seat→memory-owner seam root (birth spec v5 D1); null = no seam claim. */
  memoryOwnerRoot: string | null;
};

let report: ServerCapabilityReport | null = null;

export function setServerCapabilityReport(next: ServerCapabilityReport): void {
  report = next;
}

export function getServerCapabilityReport(): ServerCapabilityReport | null {
  return report;
}
