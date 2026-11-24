/** Thin, synchronous git calls for vault work. Never forces, never rewrites history. */

export interface GitResult { ok: boolean; out: string; err: string; code: number }

export function git(cwd: string, args: string[], timeoutMs = 60_000): GitResult {
  const proc = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return {
    ok: proc.exitCode === 0,
    out: proc.stdout.toString().trim(),
    err: proc.stderr.toString().trim(),
    code: proc.exitCode ?? -1,
  };
}

export function gitOrThrow(cwd: string, args: string[], timeoutMs?: number): string {
  const r = git(cwd, args, timeoutMs);
  if (!r.ok) throw new Error(`git ${args[0]} failed in ${cwd}: ${r.err || r.out || `exit ${r.code}`}`);
  return r.out;
}

/** Top level of the git work tree holding `dir`, or null. */
export function repoTop(dir: string): string | null {
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  return r.ok ? r.out : null;
}

export function headSha(dir: string): string | null {
  const r = git(dir, ['rev-parse', 'HEAD']);
  return r.ok ? r.out : null;
}

export function hasRemote(dir: string): boolean {
  const r = git(dir, ['remote']);
  return r.ok && r.out.length > 0;
}

export function hasUpstream(dir: string): boolean {
  return git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).ok;
}

export function isDirty(dir: string): boolean {
  const r = git(dir, ['status', '--porcelain']);
  return r.ok && r.out.length > 0;
}
