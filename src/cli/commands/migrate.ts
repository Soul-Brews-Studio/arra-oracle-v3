export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface MigrationStep {
  name: 'generate' | 'push';
  command: string[];
}

export interface MigrationStepResult extends MigrationStep {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface MigrationRunResult {
  ok: boolean;
  steps: MigrationStepResult[];
}

export type CommandRunner = (
  command: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

type Writer = (message: string) => void;

export interface RunMigrationOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  stdout?: Writer;
  stderr?: Writer;
}

export const DRIZZLE_MIGRATION_STEPS: MigrationStep[] = [
  { name: 'generate', command: ['bunx', 'drizzle-kit', 'generate'] },
  { name: 'push', command: ['bunx', 'drizzle-kit', 'push'] },
];

export async function runDrizzleMigrations(
  options: RunMigrationOptions = {},
): Promise<MigrationRunResult> {
  const runner = options.runner ?? runCommand;
  const stdout = options.stdout ?? writeStdout;
  const stderr = options.stderr ?? writeStderr;
  const steps: MigrationStepResult[] = [];

  for (const step of DRIZZLE_MIGRATION_STEPS) {
    stdout(`[migrate] running ${formatCommand(step.command)}\n`);
    const result = await runStep(step, runner, options);
    steps.push(result);
    writeProcessOutput(result, stdout, stderr);
    if (result.code !== 0) {
      stderr(`[migrate] ${step.name} failed${exitSuffix(result.code)}\n`);
      return { ok: false, steps };
    }
    stdout(`[migrate] ${step.name} complete\n`);
  }

  stdout('[migrate] migrations generated and pushed\n');
  return { ok: true, steps };
}

export async function migrateCommand(args: string[], options: RunMigrationOptions = {}): Promise<number> {
  const stdout = options.stdout ?? writeStdout;
  const stderr = options.stderr ?? writeStderr;
  if (args.includes('--help') || args.includes('-h')) {
    printHelp(stdout);
    return 0;
  }
  if (args.length > 0) {
    stderr(`unknown migrate option: ${args[0]}\n`);
    printHelp(stderr);
    return 1;
  }
  const result = await runDrizzleMigrations({ ...options, stdout, stderr });
  return result.ok ? 0 : 1;
}

async function runStep(
  step: MigrationStep,
  runner: CommandRunner,
  options: RunMigrationOptions,
): Promise<MigrationStepResult> {
  try {
    const result = await runner(step.command, { cwd: options.cwd, env: options.env });
    return { ...step, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...step, code: null, stdout: '', stderr: '', error: message };
  }
}

async function runCommand(command: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function writeProcessOutput(result: MigrationStepResult, stdout: Writer, stderr: Writer): void {
  if (result.stdout) stdout(result.stdout);
  if (result.stderr) stderr(result.stderr);
  if (result.error) stderr(`${result.error}\n`);
}

function exitSuffix(code: number | null): string {
  return code === null ? '' : ` with exit code ${code}`;
}

function formatCommand(command: string[]): string {
  return command.map(shellWord).join(' ');
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

function printHelp(write: Writer): void {
  write([
    'arra-cli migrate',
    '',
    'Runs Drizzle schema migration commands in order:',
    '  1. bunx drizzle-kit generate',
    '  2. bunx drizzle-kit push',
    '',
    'Flags:',
    '  --help, -h          show this help',
    '',
  ].join('\n'));
}

function writeStdout(message: string): void {
  process.stdout.write(message);
}

function writeStderr(message: string): void {
  process.stderr.write(message);
}
