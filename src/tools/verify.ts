/**
 * Oracle Verify Handler (bridge)
 *
 * Wraps src/verify/handler.ts for consistency with tools/ pattern.
 */

import type { ToolContext, ToolResponse, OracleVerifyInput } from './types.ts';

let verifyKnowledgeBaseFn: typeof import('../verify/handler.ts').verifyKnowledgeBase | null = null;
async function loadVerifyKnowledgeBase(): Promise<typeof import('../verify/handler.ts').verifyKnowledgeBase> {
  if (!verifyKnowledgeBaseFn) {
    verifyKnowledgeBaseFn = (await import('../verify/handler.ts')).verifyKnowledgeBase;
  }
  return verifyKnowledgeBaseFn;
}

export const verifyToolDef = {
  name: 'oracle_verify',
  description: 'Verify knowledge base integrity: compare ψ/ files on disk vs DB index. Detects missing (on disk, not indexed), orphaned (in DB, file gone), and drifted (file changed since last index) documents.',
  inputSchema: {
    type: 'object',
    properties: {
      check: {
        type: 'boolean',
        description: 'If true (default), read-only report. If false, also flag orphaned DB entries with superseded_by="_verified_orphan".',
        default: true
      },
      type: {
        type: 'string',
        description: 'Filter by document type (default: all)',
        enum: ['principle', 'pattern', 'learning', 'retro', 'all'],
        default: 'all'
      }
    }
  }
};

export async function runVerify(input: OracleVerifyInput, repoRoot: string) {
  const { check = true, type } = input;

  const verifyKnowledgeBase = await loadVerifyKnowledgeBase();
  const result = verifyKnowledgeBase({
    check,
    type,
    repoRoot,
  });

  console.error(`[VERIFY] healthy=${result.counts.healthy} missing=${result.counts.missing} orphaned=${result.counts.orphaned} drifted=${result.counts.drifted}`);

  return {
    counts: result.counts,
    missing: result.missing,
    orphaned: result.orphaned,
    drifted: result.drifted,
    untracked: result.untracked,
    mismatches: result.mismatches,
    recommendation: result.recommendation,
    ...(result.fixedOrphans ? { fixed_orphans: result.fixedOrphans } : {}),
  };
}

export async function handleVerify(ctx: ToolContext, input: OracleVerifyInput): Promise<ToolResponse> {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(await runVerify(input, ctx.repoRoot), null, 2)
    }]
  };
}
