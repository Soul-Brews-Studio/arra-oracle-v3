export type Channel = "alpha" | "beta";
export type ComputeArgs = { stable: boolean; channel?: Channel; now?: Date };

const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function dateBase(now: Date): string {
  const yy = now.getFullYear() % 100;
  return `${yy}.${now.getMonth() + 1}.${now.getDate()}`;
}

export function extractBaseFromVersion(version: string): string | null {
  if (!version) return null;
  const stripped = version.startsWith("v") ? version.slice(1) : version;
  const match = stripped.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  const [, yy, month, day] = match;
  return `${yy}.${month}.${day}`;
}

export function compareBases(a: string, b: string): number {
  const left = a.split(".").map((part) => parseInt(part, 10));
  const right = b.split(".").map((part) => parseInt(part, 10));
  if (left.length !== 3 || right.length !== 3) {
    throw new Error(`compareBases expects YY.M.D, got "${a}" vs "${b}"`);
  }
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function isValidCalendarDate(base: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(base)) return false;
  const parts = base.split(".").map((part) => parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return false;
  const [, month, day] = parts;
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month];
}

export function nextCalendarBase(base: string): string {
  if (!isValidCalendarDate(base)) {
    throw new Error(`nextCalendarBase expects a real YY.M.D date, got "${base}"`);
  }
  let [yy, month, day] = base.split(".").map((part) => parseInt(part, 10));
  day += 1;
  if (day > DAYS_IN_MONTH[month]) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      yy = (yy + 1) % 100;
    }
  }
  return `${yy}.${month}.${day}`;
}

export function effectiveBase(todayBase: string, packageVersion: string): string {
  const packageBase = extractBaseFromVersion(packageVersion);
  if (!packageBase) return todayBase;
  if (!isValidCalendarDate(packageBase)) {
    throw new Error(`ghost date in package.json: ${packageVersion} (day ${packageBase.split(".")[2]} doesn't exist in month ${packageBase.split(".")[1]}) — fix package.json version to a real date`);
  }
  return compareBases(packageBase, todayBase) > 0 ? packageBase : todayBase;
}

export function maxNFromTags(base: string, channel: Channel, tags: string[]): number {
  const prefix = `v${base}-${channel}.`;
  let max = -1;
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;
    const suffix = tag.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = parseInt(suffix, 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

export function maxAlphaFromTags(base: string, tags: string[]): number {
  return maxNFromTags(base, "alpha", tags);
}

export function maxNFromPackageJson(base: string, channel: Channel, packageVersion: string): number {
  if (!packageVersion) return -1;
  const stripped = packageVersion.startsWith("v") ? packageVersion.slice(1) : packageVersion;
  const prefix = `${base}-${channel}.`;
  if (!stripped.startsWith(prefix)) return -1;
  const suffix = stripped.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return -1;
  const n = parseInt(suffix, 10);
  return Number.isInteger(n) ? n : -1;
}

export function hhmmStamp(now: Date): string {
  return String(now.getHours() * 100 + now.getMinutes());
}

export function computeVersion(
  args: ComputeArgs,
  tags: string[] = [],
  packageVersion = "",
): string {
  const now = args.now ?? new Date();
  const todayBase = dateBase(now);
  const base = args.stable ? todayBase : effectiveBase(todayBase, packageVersion);
  if (args.stable) return base;

  const channel = args.channel ?? "alpha";
  const stamp = Number(hhmmStamp(now));
  const maxExisting = Math.max(
    maxNFromTags(base, channel, tags),
    maxNFromPackageJson(base, channel, packageVersion),
  );
  const versionBase = stamp > maxExisting ? base : nextCalendarBase(base);
  return `${versionBase}-${channel}.${stamp}`;
}
