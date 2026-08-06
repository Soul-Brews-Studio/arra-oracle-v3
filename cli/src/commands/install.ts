import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "fs";
import { join } from "path";
import { doInstall, parseInstallManifest } from "./plugins-install.ts";
import { emit } from "./_output.ts";

function printInstallHelp(): void {
  console.log("Usage: arra-cli install <url-or-path> [flags]");
  console.log("");
  console.log("Sources:");
  console.log("  https://github.com/owner/repo");
  console.log("  github.com/owner/repo");
  console.log("  git@github.com:owner/repo.git");
  console.log("  ./local/path");
  console.log("");
  console.log("Flags:");
  console.log("  --force              overwrite existing install");
  console.log("  --dry-run            show what would happen, do nothing");
  console.log("  --artifact <url>     download prebuilt .wasm directly (skip clone+build)");
  console.log("  --manifest <url>     plugin.json URL to pair with --artifact");
  console.log("  --no-backup          disable automatic backup before overwrite");
  console.log("  --backup-dir <dir>   override backup directory (default: plugin dir)");
  console.log("  --yml, --yaml        emit YAML instead of JSON");
  console.log("  -h, --help           show this help");
}

function defaultArgsToInstallArgs(args: string[]) {
  const parsed: string[] = [];
  const opts: { force?: boolean; dryRun?: boolean; artifact?: string; manifest?: string; backup?: boolean; backupDir?: string } = {};
  let source: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if (arg === "--force" || arg === "-f") {
      parsed.push(arg);
      opts.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.push(arg);
      opts.dryRun = true;
      continue;
    }
    if (arg === "--no-backup") {
      opts.backup = false;
      continue;
    }
    if (arg === "--backup-dir") {
      const value = args[i + 1];
      if (!value) return { parseError: "--backup-dir requires a value" };
      opts.backupDir = value;
      i += 1;
      continue;
    }
    if (arg === "--artifact") {
      const value = args[i + 1];
      if (!value) return { parseError: "--artifact requires a value" };
      opts.artifact = value;
      parsed.push(arg, value);
      i += 1;
      continue;
    }
    if (arg === "--manifest") {
      const value = args[i + 1];
      if (!value) return { parseError: "--manifest requires a value" };
      opts.manifest = value;
      parsed.push(arg, value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return { parseError: `unknown flag: ${arg}` };
    }
    if (!source) {
      source = arg;
      continue;
    }
    return { parseError: `too many arguments; expected one source path/url, got ${arg}` };
  }

  return { ...opts, source, args: parsed };
}

function readInstalledManifest(dest: string): string | null {
  const manifestPath = join(dest, "plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = parseInstallManifest(readFileSync(manifestPath, "utf8"));
    return `${parsed.name}@${parsed.version}`;
  } catch {
    return null;
  }
}

function backupPath(dest: string, backupDir: string): string {
  const base = dest.split(/[\\/]/).pop() || "plugin";
  const tag = new Date().toISOString().replace(/[.:]/g, "-");
  return join(backupDir, `${base}.backup-${tag}`);
}

async function backupThenInstall(source: string, installArgs: string[], options: { force?: boolean; dryRun?: boolean; backup?: boolean; backupDir?: string; }): Promise<number> {
  const installPlan = await doInstall(source, { ...options, dryRun: true });
  if (options.dryRun) {
    emit(installPlan, installArgs);
    return 0;
  }

  const target = installPlan.dest;
  const marker = `${installPlan.name}@${installPlan.version}`;
  const existing = readInstalledManifest(target);
  if (existing === marker && !options.force) {
    console.log(`✓ ${marker} already installed at ${target}`);
    return 0;
  }

  const backupsEnabled = options.backup !== false;
  const backupRoot = options.backupDir || target;
  let backupLocation: string | undefined;
  let didCreate = false;
  if (backupsEnabled && existsSync(target)) {
    mkdirSync(backupRoot, { recursive: true });
    backupLocation = backupPath(target, backupRoot);
    rmSync(backupLocation, { force: true, recursive: true });
    cpSync(target, backupLocation, { recursive: true });
    didCreate = true;
  }

  try {
    const result = await doInstall(source, { ...options, dryRun: false });
    console.log(`✓ installed ${result.name}@${result.version} -> ${result.dest}`);
    return 0;
  } catch (err) {
    if (didCreate && backupLocation && existsSync(backupLocation)) {
      rmSync(target, { recursive: true, force: true });
      cpSync(backupLocation, target, { recursive: true });
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    // Keep backup for recovery/audit unless explicitly disabled.
    if (!backupsEnabled && didCreate && backupLocation && existsSync(backupLocation)) {
      rmSync(backupLocation, { recursive: true, force: true });
    }
  }
}

export async function installCommand(args: string[]): Promise<number> {
  const parsed = defaultArgsToInstallArgs(args);

  if ("help" in parsed && parsed.help) {
    printInstallHelp();
    return 0;
  }
  if ((parsed as any).parseError) {
    printInstallHelp();
    console.error((parsed as any).parseError);
    return 1;
  }

  const source = (parsed as { source?: string }).source;
  if (!source && !(parsed as { artifact?: string }).artifact) {
    printInstallHelp();
    console.error("missing <url-or-path>; see 'arra-cli install --help'");
    return 1;
  }

  const dryRun = Boolean((parsed as { dryRun?: boolean }).dryRun);
  const installOptions = {
    force: Boolean((parsed as { force?: boolean }).force),
    dryRun,
    artifact: (parsed as { artifact?: string }).artifact,
    manifest: (parsed as { manifest?: string }).manifest,
    backup: (parsed as { backup?: boolean }).backup,
  };

  const installArgs = Array.isArray((parsed as any).args) ? (parsed as any).args : [];
  try {
    return await backupThenInstall(source || (parsed as { artifact?: string }).artifact || "", [...installArgs, ...args.filter((a) => a === "--json" || a === "--yml" || a === "--yaml")], {
      ...installOptions,
      backupDir: (parsed as { backupDir?: string }).backupDir,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
