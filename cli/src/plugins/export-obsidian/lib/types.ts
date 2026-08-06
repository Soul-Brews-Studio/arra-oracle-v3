// Shared types for the export-obsidian plugin.
// Owned by: weaver (issue #933, part 1).
// Contract for threader (fetch-*) + scribe (render-*) so all three PRs can land independently.
//
// When threader and scribe add their files, they MUST import from "./types.ts" —
// do not redeclare these shapes locally.

/** A doc as returned by the ARRA Oracle HTTP API. */
export interface ApiDoc {
  /** Oracle-assigned ULID/UUID. */
  id: string;
  /** principle | pattern | learning | retro | reflection | trace | ... */
  type: string;
  /** Raw markdown body (without frontmatter). */
  content: string;
  /** Concept tags (array of snake_case slugs). */
  concepts: string[];
  /** Source project (e.g. "Soul-Brews-Studio/arra-oracle-v3"). */
  project?: string;
  /** ISO-8601 timestamp. */
  created_at?: string;
  /** Source file path, if the doc was imported from disk. */
  source_file?: string;
  /** Human-facing title. May be synthesised from content if missing. */
  title?: string;
}

/** A single similarity edge between two docs. */
export interface SimilarResult {
  /** The target doc id. */
  id: string;
  /** Cosine similarity [0, 1]. */
  score: number;
  /** Optional pre-resolved title for the target (scribe may supply). */
  title?: string;
  /** Target doc type (threader may supply from /api/similar). */
  type?: string;
  /** Target source file path (threader may supply). */
  source_file?: string;
}

/** Frontmatter metadata attached to each exported doc. */
export interface DocMeta {
  arra_id: string;
  arra_type: string;
  arra_project?: string;
  arra_created?: string;
  muninn_concepts: string[];
  arra_model: string;
  arra_similarity_threshold: number;
}

/** Aggregate stats consumed by render-index.ts. */
export interface VaultStats {
  total: number;
  byType: Record<string, number>;
  byProject: Record<string, number>;
  topConcepts: Array<{ name: string; count: number }>;
  topLinked?: Array<{ slug: string; linkCount: number }>;
  generatedAt: Date;
}

/** CLI flags parsed by index.ts and threaded through the pipeline. */
export interface ExportOptions {
  out: string;
  model: "bge-m3" | "nomic" | "qwen3";
  threshold: number;
  maxLinks: number;
  types: string[] | null;
  project: string | null;
  dryRun: boolean;
  incremental: boolean;
  format: "standard" | "dataview";
}

/** A file ready to be written to the Obsidian vault. */
export interface VaultFile {
  /** Path relative to the vault root (e.g. "learnings/2026-04-19_foo.md"). */
  relPath: string;
  /** Full file content (frontmatter + body). */
  content: string;
  /** Optional mtime to stamp on the written file (incremental mode). */
  mtime?: Date;
}

/** Result of a vault write pass. */
export interface VaultWriteReport {
  /** Files newly written or changed. */
  written: number;
  /** Files skipped due to --dry-run. */
  skipped: number;
  /** Files unchanged (incremental mode — content hash matched). */
  unchanged: number;
  /** Per-file errors, if any. */
  errors: Array<{ relPath: string; message: string }>;
}
