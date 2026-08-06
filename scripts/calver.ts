#!/usr/bin/env bun
// CalVer bump for arra-oracle-v3: v{yy}.{m}.{d}[-(alpha|beta).{HMM}]

import { $ } from "bun";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Channel } from "./calver-core.ts";
import {
  computeVersion,
  dateBase,
  effectiveBase,
  extractBaseFromVersion,
  isValidCalendarDate,
} from "./calver-core.ts";

export {
  compareBases,
  computeVersion,
  dateBase,
  effectiveBase,
  extractBaseFromVersion,
  hhmmStamp,
  isValidCalendarDate,
  maxAlphaFromTags,
  maxNFromPackageJson,
  maxNFromTags,
  nextCalendarBase,
} from "./calver-core.ts";

export type { Channel } from "./calver-core.ts";

type Args = { stable: boolean; channel?: Channel; check: boolean; now?: Date };

const HELP = `Usage: bun scripts/calver.ts [options]

Compute next CalVer version and bump package.json.

Scheme: v{yy}.{m}.{d}[-(alpha|beta).{HMM}] — HMM is H*100+M rendered
as a numeric pre-release identifier. If HMM collides with or is below the
max existing tag/package suffix for today's base, the base skips to tomorrow.

Options:
  --stable         Cut stable (no alpha/beta suffix)
  --beta           Cut beta instead of alpha
  --check          Dry-run: print target, don't modify files
  -h, --help       Show help`;

function parseArgs(argv: string[]): Args {
  const args: Args = { stable: false, channel: "alpha", check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stable") args.stable = true;
    else if (arg === "--beta") args.channel = "beta";
    else if (arg === "--check" || arg === "--dry-run") args.check = true;
    else if (arg === "--hour") fail("--hour deprecated; CalVer uses HMM wall-clock suffixes", 2);
    else if (arg === "-h" || arg === "--help") {
      console.log(HELP);
      process.exit(0);
    } else fail(`unknown arg: ${arg}\n${HELP}`, 2);
  }
  if (args.stable && args.channel === "beta") fail("--stable and --beta are mutually exclusive", 2);
  return args;
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

async function listChannelTags(base: string, channel: Channel): Promise<string[]> {
  const res = await $`git tag --list ${`v${base}-${channel}.*`}`.nothrow().quiet();
  if (res.exitCode !== 0) return [];
  return res.stdout.toString().split("\n").map((s) => s.trim()).filter(Boolean);
}

async function tagExists(version: string): Promise<boolean> {
  const res = await $`git rev-parse --verify --quiet ${`v${version}`}`.nothrow().quiet();
  return res.exitCode === 0;
}

function reportGhostDate(pkgVersion: string, pkgBase: string, now: Date, todayBase: string): never {
  const [, month, day] = pkgBase.split(".").map(Number);
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  console.error(`\n❌ ghost date in package.json: ${pkgVersion}`);
  console.error(`   day ${day} doesn't exist in ${names[month] || `month ${month}`} (max: ${days[month] ?? "?"})`);
  console.error(`\n   CalVer scheme: v{YY}.{M}.{D}[-{channel}.{HMM}]`);
  console.error(`     YY=${now.getFullYear() % 100} M=${now.getMonth() + 1} D=${now.getDate()} HMM=hour*100+minute`);
  console.error(`\n   fix: set "version" to "${todayBase}" in package.json, then re-run\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = args.now ?? new Date();
  const todayBase = dateBase(now);
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const packageVersion = String(pkg.version ?? "");

  const pkgBase = extractBaseFromVersion(packageVersion);
  if (pkgBase && !isValidCalendarDate(pkgBase)) reportGhostDate(packageVersion, pkgBase, now, todayBase);

  const channelForTags: Channel = args.channel ?? "alpha";
  const base = args.stable ? todayBase : effectiveBase(todayBase, packageVersion);
  const tags = args.stable ? [] : await listChannelTags(base, channelForTags);
  const version = computeVersion(args, tags, packageVersion);
  const channel = args.stable ? "stable" : channelForTags;

  console.log(`Target: v${version}  [${channel}]`);
  if (args.check) {
    console.log("(check mode — no changes written)");
    return;
  }

  if (await tagExists(version)) {
    console.error(`\n❌ tag v${version} already exists`);
    console.error(args.stable ? "   → stable for today already cut; nothing to do" : "   → race detected: another tag was created between scan and bump");
    process.exit(1);
  }

  const old = pkg.version;
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`✓ package.json: ${old} → ${version}`);
  console.log(`\nNext:\n  git add package.json && git commit -m "bump: v${version}" && git push origin alpha`);
}

if (import.meta.main) main();
