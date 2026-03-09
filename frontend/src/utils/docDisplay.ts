/**
 * Shared helper for computing document display info (project links, vault URLs, paths).
 * Used across DocDetail, Traces, Superseded, and LogCard (search results).
 *
 * Vault repo is read from /api/stats (configured via `oracle-vault init`).
 * No hardcoded defaults — each subscriber has their own vault.
 */

/** Cached vault repo from /api/stats — null until loaded */
let _vaultRepo: string | null = null;

/** Call once on app init to set the vault repo from /api/stats */
export function setVaultRepo(repo: string) {
  _vaultRepo = repo;
}

function getVaultBase(): string | null {
  if (!_vaultRepo) return null;
  return `https://github.com/${_vaultRepo}/blob/main`;
}

export interface DocDisplayInfo {
  /** Clean display path (strips github.com/owner/repo/ prefix) */
  displayPath: string;
  /** URL to the project's directory in oracle-vault, or null */
  projectVaultUrl: string | null;
  /** Short display name for the project (e.g. "soul-brews-studio/shrimp-oracle") */
  projectDisplay: string | null;
  /** URL to the specific file in oracle-vault, or null if no vault configured */
  vaultUrl: string | null;
  /** URL to the file on the project's own GitHub repo (for "View on GitHub"), or null */
  fileUrl: string | null;
  /** True if no project is associated (universal doc) */
  isUniversal: boolean;
}

/**
 * Compute display info for a document.
 * @param sourceFile - The source_file path (e.g. "github.com/owner/repo/ψ/memory/learnings/foo.md")
 * @param project - Optional project field (e.g. "github.com/owner/repo")
 */
export function getDocDisplayInfo(sourceFile: string, project?: string | null): DocDisplayInfo {
  const displayPath = sourceFile.startsWith('github.com/')
    ? sourceFile.replace(/^github\.com\/[^/]+\/[^/]+\//, '')
    : sourceFile;

  const isUniversal = !project;
  const vaultBase = getVaultBase();

  let projectVaultUrl: string | null = null;
  let projectDisplay: string | null = null;
  let fileUrl: string | null = null;
  let vaultUrl: string | null = null;

  if (project) {
    const ghProject = project.includes('github.com') ? project : `github.com/${project}`;
    if (vaultBase) projectVaultUrl = `${vaultBase}/${ghProject}`;
    projectDisplay = project.replace('github.com/', '');
    fileUrl = `https://${ghProject}/blob/main/${displayPath}`;
  }

  if (vaultBase) vaultUrl = `${vaultBase}/${sourceFile}`;

  return { displayPath, projectVaultUrl, projectDisplay, vaultUrl, fileUrl, isUniversal };
}
