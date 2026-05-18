// Shared types for the import-obsidian plugin (issue #938).
// Round-trip: Obsidian vault → ARRA docs.

/** Parsed frontmatter from an Obsidian .md file. */
export interface DocMeta {
  arra_id?: string;
  arra_type?: string;
  arra_project?: string;
  arra_created?: string;
  muninn_concepts?: string[];
  [key: string]: unknown;
}

/** A parsed Obsidian doc ready for diff + apply. */
export interface ImportDoc {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to vault root, forward-slash. */
  relPath: string;
  /** Parsed frontmatter (arra_id etc.). */
  meta: DocMeta;
  /** Body without frontmatter and leading H1. */
  body: string;
  /** Title — from H1 if present, else filename base. */
  title: string;
  /** Concepts merged from frontmatter + #tag lines in body, lowercased + deduped. */
  concepts: string[];
  /** Hash of (title + body + concepts) — the payload we send to ARRA. */
  contentHash: string;
}

/** Entry in .arra-vault-state.json. */
export interface StateEntry {
  relPath: string;
  contentHash: string;
}

/** Vault state file written at export time, read at import time. */
export interface VaultState {
  version: number;
  last_export: string;
  model?: string;
  threshold?: number;
  docs: Record<string, StateEntry>;
}

/** Classification of a single doc vs. the state file. */
export type ImportAction = 'update' | 'create' | 'skip-unchanged' | 'skip-no-id' | 'tombstone';

export interface ImportPlanItem {
  doc?: ImportDoc;
  /** For tombstone entries (doc was in state, missing from vault). */
  arraId?: string;
  /** For tombstone entries. */
  relPath?: string;
  action: ImportAction;
  reason?: string;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  summary: {
    changed: number;
    created: number;
    unchanged: number;
    skippedNoId: number;
    tombstoned: number;
  };
}

export interface ImportResult {
  applied: number;
  created: number;
  failed: number;
  skipped: number;
  errors: Array<{ relPath: string; message: string }>;
}

export interface ImportOptions {
  in: string;
  dryRun: boolean;
  onlyChanged: boolean;
  types: string[] | null;
  createNew: boolean;
  deleteMissing: boolean;
  verbose: boolean;
}
