#!/usr/bin/env bun
/**
 * Opt-in Stop/PreCompact hook: mine the just-ended session JSONL into one
 * deduped oracle_learn entry. Default-off; enable with ARRA_HUGINN_CAPTURE=1.
 *
 * Hook JSON stdin may include: transcript_path, session_id, cwd.
 * CLI fallback: bun scripts/huginn-capture-hook.ts /path/to/session.jsonl [session-id]
 */
import { captureSession, huginnEnabled, readHookInput } from '../src/huginn/capture.ts';

const stdin = await new Response(Bun.stdin.stream()).text();
const input = readHookInput(stdin);
const transcriptPath = input.transcriptPath || Bun.argv[2];
const sessionId = input.sessionId || Bun.argv[3];

if (!huginnEnabled()) {
  console.log(JSON.stringify({ ok: true, skipped: 'disabled', message: 'Set ARRA_HUGINN_CAPTURE=1 to enable Huginn auto-capture.' }));
  process.exit(0);
}

if (!transcriptPath) {
  console.log(JSON.stringify({ ok: true, skipped: 'missing-transcript', message: 'No transcript path supplied.' }));
  process.exit(0);
}

try {
  const result = await captureSession({ transcriptPath, sessionId, cwd: input.cwd });
  console.log(JSON.stringify(result, null, 2));
} catch (error: any) {
  console.error(JSON.stringify({ ok: false, error: error?.message ?? String(error) }, null, 2));
  process.exit(1);
}
