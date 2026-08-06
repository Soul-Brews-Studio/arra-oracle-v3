import { join } from 'node:path';
import type { InvokeResult, Runner } from './serve.ts';

export const LOCAL_CLI_HELP: Record<string, string> = {
  backup: 'backup [--out-dir DIR]',
  changelog: 'changelog [--since TAG] [--out FILE] [--stdout]',
  completions: 'completions <bash|zsh|fish>',
  config: 'config [show|path|use NAME]',
  'canvas-plugins': 'canvas-plugins [--kind three|react] [--id ID] [--json]',
  'canvas-serve': 'canvas-serve [--port N] [--api-base URL]',
  doctor: 'doctor [--json]',
  export: 'export --format json|markdown [--out FILE]',
  'export-obsidian': 'export-obsidian --out PATH [--dry-run]',
  huginn: 'huginn sweep [--json]',
  import: 'import --format json [--in FILE]',
  'import-obsidian': 'import-obsidian --in PATH [--dry-run]',
  migrate: 'migrate',
  peers: 'peers [--json]',
  plugin: 'plugin <list|info|install|remove>',
  release: 'release [--beta|--stable] [--dry-run]',
  seed: 'seed',
  session: 'session <list|show|context>',
  use: 'use <target>',
  vault: 'vault [sync|status|pull] [--dry-run]',
};

const REPO_SLUGS = ['Soul-Brews-Studio/arra-oracle-v3', 'github.com/Soul-Brews-Studio/arra-oracle-v3'];
const CANONICAL: Record<string, string> = Object.fromEntries(
  Object.keys(LOCAL_CLI_HELP).flatMap(name => [[name, name], [name.replace(/-/g, '_'), name]]),
);

export function resolveLocalCliName(name: string): string | undefined {
  return CANONICAL[name.toLowerCase().replace(/-/g, '_')];
}

async function resolveRoot(env: Record<string, string | undefined>, runner: Runner): Promise<string> {
  const explicit = env.ORACLE_ROOT?.trim();
  if (explicit) return explicit;
  for (const slug of REPO_SLUGS) {
    const result = await runner('ghq', ['locate', slug], { capture: true });
    if (result.code === 0 && result.stdout?.trim()) return result.stdout.trim();
  }
  return process.cwd();
}

export async function runLocalCli(
  command: string,
  args: string[],
  runner: Runner,
  env: Record<string, string | undefined>,
): Promise<InvokeResult> {
  const name = resolveLocalCliName(command);
  if (!name) return { ok: false, error: `unknown local CLI command: ${command}` };
  try {
    const cwd = await resolveRoot(env, runner);
    const result = await runner('bun', ['run', join('cli', 'src', 'cli.ts'), name, ...args], {
      cwd,
      env,
      capture: true,
    });
    const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join('\n');
    return result.code === 0
      ? { ok: true, output: output || `arra ${name}: ok` }
      : { ok: false, error: output || `arra ${name} failed${result.code === null ? '' : ` (${result.code})`}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
