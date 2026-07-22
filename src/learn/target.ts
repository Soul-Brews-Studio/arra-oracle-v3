import fs from 'node:fs';
import path from 'node:path';
import { canonicalProject } from './authority.ts';

export interface LearnTarget {
  absDir: string;
  sourceFileRel: string;
  vaultRoot: string | null;
  fallbackRoot: string;
  subdir: string;
}
export interface LearningIdentity {
  id: string;
  filename: string;
  filePath: string;
  sourceFile: string;
}

export function resolveVaultLearnTarget(
  project: string | null,
  vaultRoot: string | null,
  subdir = 'ψ/memory/learnings',
  fallbackRoot = process.cwd(),
): LearnTarget {
  const safeSubdir = posixSubdir(subdir);
  const canonical = project === null ? null : canonicalProject(project);
  if (project !== null && !canonical) throw new TypeError('Invalid project authority');
  const safeFallbackRoot = resolvedRoot(fallbackRoot);
  if (vaultRoot) {
    const safeVaultRoot = resolvedRoot(vaultRoot);
    const prefix = canonical || '_universal';
    const absDir = path.resolve(safeVaultRoot, ...prefix.split('/'), ...safeSubdir.split('/'));
    assertContained(absDir, safeVaultRoot);
    return {
      absDir,
      sourceFileRel: `${prefix}/${safeSubdir}`,
      vaultRoot: safeVaultRoot,
      fallbackRoot: safeFallbackRoot,
      subdir: safeSubdir,
    };
  }
  const absDir = path.resolve(safeFallbackRoot, ...safeSubdir.split('/'));
  assertContained(absDir, safeFallbackRoot);
  return {
    absDir,
    sourceFileRel: safeSubdir,
    vaultRoot: null,
    fallbackRoot: safeFallbackRoot,
    subdir: safeSubdir,
  };
}

export function identityCandidate(dateStr: string, slug: string, suffix = 1): Pick<LearningIdentity, 'id' | 'filename'> {
  const tail = suffix === 1 ? slug : `${slug}-${suffix}`;
  return { id: `learning_${dateStr}_${tail}`, filename: `${dateStr}_${tail}.md` };
}

export function reserveGeneratedLearning(opts: {
  dateStr: string;
  slug: string;
  target: LearnTarget;
  idExists: (id: string) => boolean;
  content: (identity: Pick<LearningIdentity, 'id' | 'filename'>) => string;
}): LearningIdentity {
  prepareTarget(opts.target.absDir);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = identityCandidate(opts.dateStr, opts.slug, suffix);
    if (opts.idExists(candidate.id) || fileExistsInCanonicalRoots(opts.target, candidate.filename)) continue;
    const reserved = reserveFile(opts.target, candidate, opts.content(candidate));
    if (reserved) return reserved;
  }
}

export function reserveExplicitLearning(opts: {
  id: string;
  sourceFile: string;
  target: LearnTarget;
  idExists: (id: string) => boolean;
  content: (identity: Pick<LearningIdentity, 'id' | 'filename'>) => string;
}): LearningIdentity | null {
  const filename = explicitFilename(opts.id, opts.sourceFile);
  if (!filename) throw new TypeError('Invalid learning sourceFile');
  if (opts.idExists(opts.id) || fileExistsInCanonicalRoots(opts.target, filename)) return null;
  prepareTarget(opts.target.absDir);
  return reserveFile(opts.target, { id: opts.id, filename }, opts.content({ id: opts.id, filename }));
}

export function explicitFilename(id: string, sourceFile: string): string | null {
  if (!sourceFile || sourceFile.includes('\0') || sourceFile.includes('\\')) return null;
  if (!sourceFile.startsWith('ψ/memory/learnings/')) return null;
  const tail = sourceFile.slice('ψ/memory/learnings/'.length);
  if (!tail || tail.includes('/') || path.posix.basename(tail) !== tail || !tail.endsWith('.md')) return null;
  return tail === `${id}.md` ? tail : null;
}

function reserveFile(
  target: LearnTarget,
  candidate: Pick<LearningIdentity, 'id' | 'filename'>,
  content: string,
): LearningIdentity | null {
  assertMarkdownBasename(candidate.filename);
  const filePath = path.join(target.absDir, candidate.filename);
  try {
    fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  return { ...candidate, filePath, sourceFile: `${target.sourceFileRel}/${candidate.filename}` };
}

function prepareTarget(absDir: string): void {
  assertNoSymlinkParents(absDir);
  fs.mkdirSync(absDir, { recursive: true });
  assertNoSymlinkParents(absDir);
}

function assertNoSymlinkParents(absDir: string): void {
  const absolute = path.resolve(absDir);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Learning target parent is a symlink: ${cursor}`);
  }
}

function posixSubdir(subdir: string): string {
  if (subdir.includes('\0') || subdir.includes('\\') || path.posix.isAbsolute(subdir)) throw new TypeError('Invalid learning subdir');
  const normalized = path.posix.normalize(subdir);
  if (normalized !== subdir || normalized.startsWith('../') || !normalized.startsWith('ψ/memory/')) throw new TypeError('Invalid learning subdir');
  return normalized;
}

function assertMarkdownBasename(filename: string): void {
  if (path.basename(filename) !== filename || !filename.endsWith('.md') || filename === '.md') {
    throw new TypeError('Learning filename must be a flat .md basename');
  }
}

function fileExistsInCanonicalRoots(target: LearnTarget, filename: string): boolean {
  const flat = path.join(target.fallbackRoot, ...target.subdir.split('/'), filename);
  if (fs.existsSync(flat)) return true;
  if (!target.vaultRoot) return false;
  const universal = path.join(target.vaultRoot, '_universal', ...target.subdir.split('/'), filename);
  if (fs.existsSync(universal)) return true;
  for (const host of ['github.com', 'gitlab.com', 'bitbucket.org']) {
    const hostDir = path.join(target.vaultRoot, host);
    for (const owner of childNames(hostDir)) {
      for (const repo of childNames(path.join(hostDir, owner))) {
        if (fs.existsSync(path.join(hostDir, owner, repo, ...target.subdir.split('/'), filename))) return true;
      }
    }
  }
  return false;
}

function childNames(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function resolvedRoot(root: string): string {
  const absolute = path.resolve(root);
  try { return fs.realpathSync(absolute); } catch { return absolute; }
}

function assertContained(candidate: string, root: string): void {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new TypeError('Learning target escapes configured root');
  }
}
