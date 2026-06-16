import fs from 'fs';
import { detectProject } from '../server/project-detect.ts';
import { findPsiRepos, migrate, walkFiles } from './migrate.ts';

export function runVaultMigrateCli(args = process.argv.slice(2)): void {
  if (args.includes('--list')) {
    const repos = findPsiRepos();
    console.log(`Found ${repos.length} repos with ψ/ directories:\n`);
    for (const { repoPath, psiDir } of repos) {
      const project = detectProject(repoPath) ?? '(unknown)';
      const isSymlink = fs.lstatSync(psiDir).isSymbolicLink();
      if (isSymlink) console.log(`  ${project} ✓ symlinked`);
      else console.log(`  ${project} (${walkFiles(psiDir, repoPath).length} files) ← local`);
      console.log(`    ${repoPath}`);
    }
    return;
  }

  const dryRun = args.includes('--dry-run');
  const symlink = args.includes('--symlink');
  if (dryRun) console.error('[Vault] DRY RUN — no files will be copied\n');
  if (symlink) console.error('[Vault] SYMLINK MODE — local ψ/ will be replaced with symlinks\n');
  console.log(JSON.stringify(migrate({ dryRun, symlink }), null, 2));
}
