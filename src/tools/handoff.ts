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
  name: 'oracle_handoff',
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
  // Null-guard: MCP clients sometimes call with no args. Show usage instead of crashing.
  if (input == null || typeof input !== 'object') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_handoff requires field 'content' (string). Optional: 'slug' (string).",
          usage: "arra_handoff({ content: 'session summary markdown...', slug: 'optional-slug' })",
          tip: "To list existing handoffs, use arra_inbox() instead."
        }, null, 2)
      }],
      isError: true
    };
  }

  const { content, slug: slugInput } = input as { content?: unknown; slug?: unknown };

  // Validate content: must be a non-empty string before any string ops.
  if (typeof content !== 'string' || content.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_handoff requires field 'content' (non-empty string).",
          received: content === undefined ? 'undefined' : typeof content,
          usage: "arra_handoff({ content: 'session summary markdown...', slug: 'optional-slug' })",
          tip: "To list existing handoffs, use arra_inbox() instead."
        }, null, 2)
      }],
      isError: true
    };
  }

  // Validate optional slug type if supplied.
  if (slugInput !== undefined && typeof slugInput !== 'string') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: "arra_handoff field 'slug' must be a string when provided.",
          received: typeof slugInput
        }, null, 2)
      }],
      isError: true
    };
  }

  const now = new Date();

  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
        message: `Handoff written${vaultRoot ? ' (vault)' : ''}. Next session can read it with oracle_inbox().`
      }, null, 2)
    }]
  };
}
