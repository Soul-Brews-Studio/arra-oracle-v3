import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { discoverPlugins } from "../../plugin/loader.ts";
import { join, resolve } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, cpSync, symlinkSync, rmSync } from "fs";
import { createHash } from "crypto";

const USER_PLUGIN_DIR = join(homedir(), ".arra", "plugins");

const USAGE = `arra-cli plugin — manage plugins

Usage: arra-cli plugin <subcommand> [args]

Subcommands:
  init <name>             Scaffold a new plugin in ~/.arra/plugins/<name>/
  list                    List installed plugins (bundled + user)
  install <path> [--link] Install plugin dir by copy (--link to symlink for dev)
  build [path]            Hash entry file, update plugin.json artifact field
  remove <name>           Archive then remove user plugin (Principle 1: Nothing is Deleted)`;

async function cmdInit(name: string): Promise<InvokeResult> {
  if (!name) return { ok: false, error: "usage: arra-cli plugin init <name>" };
  if (!/^[a-z0-9-]+$/.test(name)) {
    return { ok: false, error: `plugin name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(name)}` };
  }
  const dir = join(USER_PLUGIN_DIR, name);
  if (existsSync(dir)) {
    return { ok: false, error: `plugin '${name}' already exists at ${dir}` };
  }
  mkdirSync(dir, { recursive: true });

  const manifest = {
    name,
    version: "0.1.0",
    entry: "./index.ts",
    sdk: "^0.0.1",
    cli: { command: name, help: `${name} — custom plugin` },
  };
  await Bun.write(join(dir, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(
    join(dir, "index.ts"),
    `import type { InvokeContext, InvokeResult } from "../../../cli/src/plugin/types.ts";\n\nexport default async function handler(_ctx: InvokeContext): Promise<InvokeResult> {\n  console.log("Hello from ${name}!");\n  return { ok: true };\n}\n`
  );
  return { ok: true, output: `✓ scaffolded '${name}' → ${dir}` };
}

async function cmdList(): Promise<InvokeResult> {
  const { plugins, bundled, user } = await discoverPlugins();
  if (!plugins.length) return { ok: true, output: "no plugins installed" };
  const header = `${"COMMAND".padEnd(20)} ${"VERSION".padEnd(10)} ${"SOURCE".padEnd(8)} DESCRIPTION`;
  const divider = "-".repeat(70);
  const lines = plugins.map(p => {
    const cmd = p.manifest.cli?.command ?? p.manifest.name;
    const ver = p.manifest.version;
    const source = p.dir.startsWith(USER_PLUGIN_DIR) ? "user" : "bundled";
    const desc = p.manifest.cli?.help ?? p.manifest.description ?? "";
    return `${cmd.padEnd(20)} ${ver.padEnd(10)} ${source.padEnd(8)} ${desc}`;
  });
  const summary = user > 0 ? `${bundled} bundled, ${user} user` : `${bundled} bundled`;
  return { ok: true, output: [`plugins (${plugins.length} — ${summary}):`, header, divider, ...lines].join("\n") };
}

async function cmdInstall(args: string[]): Promise<InvokeResult> {
  const link = args.includes("--link");
  const pathArg = args.find(a => !a.startsWith("--"));
  if (!pathArg) return { ok: false, error: "usage: arra-cli plugin install <path> [--link]" };

  const src = resolve(pathArg);
  if (!existsSync(src)) {
    return { ok: false, error: `path not found: ${src}` };
  }
  const manifestPath = join(src, "plugin.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, error: `no plugin.json found in: ${src}` };
  }

  const raw = await Bun.file(manifestPath).json();
  const name = raw.name as string;
  if (!name) return { ok: false, error: "plugin.json missing 'name' field" };

  mkdirSync(USER_PLUGIN_DIR, { recursive: true });
  const dest = join(USER_PLUGIN_DIR, name);
  if (existsSync(dest)) {
    return { ok: false, error: `plugin '${name}' already installed at ${dest}` };
  }

  if (link) {
    symlinkSync(src, dest);
    return { ok: true, output: `✓ linked '${name}' → ${dest}\n  symlink to ${src}` };
  }
  cpSync(src, dest, { recursive: true });
  return { ok: true, output: `✓ installed '${name}' → ${dest}` };
}

async function cmdBuild(pathArg: string): Promise<InvokeResult> {
  const dir = pathArg ? resolve(pathArg) : process.cwd();
  const manifestPath = join(dir, "plugin.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, error: `no plugin.json found in ${dir}` };
  }
  const raw = await Bun.file(manifestPath).json();
  const entry = raw.entry as string;
  if (!entry) return { ok: false, error: "plugin.json missing 'entry' field" };

  const entryPath = resolve(dir, entry);
  if (!existsSync(entryPath)) {
    return { ok: false, error: `entry file not found: ${entryPath}` };
  }

  const contents = await Bun.file(entryPath).arrayBuffer();
  const sha256 = createHash("sha256").update(new Uint8Array(contents)).digest("hex");

  raw.artifact = { path: entry, sha256 };
  await Bun.write(manifestPath, JSON.stringify(raw, null, 2) + "\n");

  return {
    ok: true,
    output: `✓ build: ${raw.name as string}@${raw.version as string}\n  entry:  ${entryPath}\n  sha256: ${sha256}`,
  };
}

async function cmdRemove(name: string): Promise<InvokeResult> {
  if (!name) return { ok: false, error: "usage: arra-cli plugin remove <name>" };
  const dir = join(USER_PLUGIN_DIR, name);
  if (!existsSync(dir)) {
    return { ok: false, error: `plugin '${name}' not found in ${USER_PLUGIN_DIR}` };
  }

  // Principle 1: Nothing is Deleted — archive to /tmp before removing
  const archive = `/tmp/arra-cli-removed-${name}-${Date.now()}`;
  cpSync(dir, archive, { recursive: true });
  rmSync(dir, { recursive: true, force: true });

  return { ok: true, output: `✓ removed '${name}'\n  archived → ${archive}` };
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const [sub, ...rest] = ctx.args;

  switch (sub) {
    case "init":
      return cmdInit(rest[0] ?? "");
    case "list":
    case "ls":
      return cmdList();
    case "install":
      return cmdInstall(rest);
    case "build":
      return cmdBuild(rest[0] ?? "");
    case "remove":
    case "rm":
      return cmdRemove(rest[0] ?? "");
    default:
      if (sub) console.error(`✗ unknown subcommand: ${sub}`);
      return { ok: true, output: USAGE };
  }
}
