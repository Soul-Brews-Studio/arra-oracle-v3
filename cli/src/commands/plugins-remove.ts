import { join } from "path";
import { homedir } from "os";
import { existsSync, rmSync, statSync } from "fs";
import { emit } from "./_output.ts";

const ORACLE_PLUGIN_DIR = join(homedir(), ".oracle", "plugins");

async function confirm(prompt: string): Promise<boolean> {
  process.stderr.write(prompt);
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const input = new TextDecoder().decode(value).trim().toLowerCase();
  return input === "y" || input === "yes";
}

export async function pluginsRemove(args: string[]): Promise<number> {
  const yes = args.includes("--yes") || args.includes("-y");
  const name = args.find(a => !a.startsWith("-"));

  if (!name) {
    console.error("usage: arra-cli plugin remove <name> [--yes]");
    return 1;
  }

  const dirPath = join(ORACLE_PLUGIN_DIR, name);
  const wasmPath = join(ORACLE_PLUGIN_DIR, `${name}.wasm`);

  let target: string | null = null;
  let kind: "dir" | "file" | null = null;

  if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
    target = dirPath;
    kind = "dir";
  } else if (existsSync(wasmPath) && statSync(wasmPath).isFile()) {
    target = wasmPath;
    kind = "file";
  }

  if (!target) {
    console.error(`plugin '${name}' not found in ${ORACLE_PLUGIN_DIR}`);
    return 1;
  }

  if (!yes) {
    const ok = await confirm(`Remove ${kind} ${target}? [y/N] `);
    if (!ok) {
      emit({ removed: false, aborted: true, target, kind }, args);
      return 1;
    }
  }

  rmSync(target, { recursive: true, force: true });
  emit({ removed: true, target, kind }, args);
  return 0;
}
