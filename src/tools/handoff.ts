/**
 * Oracle Handoff Handler
 *
 * Write session context to ψ/inbox/handoff/ for future sessions.
 * When vault is configured, writes to vault repo with project-nested paths.
 */

import path from 'path';
import fs from 'fs';
import { getVaultPsiRoot } from '../vault/handler.ts';
import { detectProject } from '../server/project-detect.ts';
import type { ToolContext, ToolResponse, OracleHandoffInput } from './types.ts';

export const handoffToolDef = {
  name: 'muninn_handoff',
  description: 'Write session context to the Oracle inbox for future sessions to pick up. Creates a timestamped markdown file in ψ/inbox/handoff/. Use at end of sessions to preserve context.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The handoff content (markdown). Include context, progress, next steps.'
      },
      slug: {
        type: 'string',
        description: 'Optional slug for the filename. Auto-generated from content if not provided.'
      }
    },
    required: ['content']
  }
};

export async function handleHandoff(ctx: ToolContext, input: OracleHandoffInput): Promise<ToolResponse> {
  const { content, slug: slugInput } = input;
  const now = new Date();

  const dateStr = now.toISOString().split('T')[0];
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

  const slug = slugInput || content
    .substring(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'handoff';

  const filename = `${dateStr}_${timeStr}_${slug}.md`;

  // Resolve vault root for central writes
  const vault = getVaultPsiRoot();
  if ('needsInit' in vault) console.error(`[Vault] ${vault.hint}`);
  const vaultRoot = 'path' in vault ? vault.path : null;

  const project = detectProject(ctx.repoRoot)?.toLowerCase() || '_universal';

  let dirPath: string;
  let sourceFileRel: string;
  if (vaultRoot) {
    dirPath = path.join(vaultRoot, project, 'ψ', 'inbox', 'handoff');
    sourceFileRel = `${project}/ψ/inbox/handoff/${filename}`;
  } else {
    dirPath = path.join(ctx.repoRoot, 'ψ/inbox/handoff');
    sourceFileRel = `ψ/inbox/handoff/${filename}`;
  }

  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, filename), content, 'utf-8');

  console.error(`[MCP:HANDOFF] Written: ${sourceFileRel}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        file: sourceFileRel,
        message: `Handoff written${vaultRoot ? ' (vault)' : ''}. Next session can read it with muninn_inbox().`
      }, null, 2)
    }]
  };
}
