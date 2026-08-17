// Lazy imports keep the synchronous tools barrel free of top-level-await TDZs.
let enqueueIndexJob: ((sqlite: any, opts: any) => void) | null = null;
let enqueueLoaded = false;

export async function loadEnqueue(): Promise<typeof enqueueIndexJob> {
  if (enqueueLoaded) return enqueueIndexJob;
  enqueueLoaded = true;
  try {
    enqueueIndexJob = (await import('../indexer/jobs.ts')).enqueueIndexJob;
  } catch {
    // Learn still works when the optional indexer is unavailable.
  }
  return enqueueIndexJob;
}

let getVaultPsiRootFn: typeof import('../vault/handler.ts').getVaultPsiRoot | null = null;

export async function loadGetVaultPsiRoot(): Promise<typeof import('../vault/handler.ts').getVaultPsiRoot> {
  if (!getVaultPsiRootFn) {
    getVaultPsiRootFn = (await import('../vault/handler.ts')).getVaultPsiRoot;
  }
  return getVaultPsiRootFn;
}

/** Coerce concepts to string[] — handles string, array, or undefined from MCP input. */
export function coerceConcepts(concepts: unknown): string[] {
  if (Array.isArray(concepts)) return concepts.map(String);
  if (typeof concepts === 'string') return concepts.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

export const learnToolDef = {
  name: 'oracle_learn',
  description: 'Add a new pattern or learning to the Oracle knowledge base. Creates a markdown file in ψ/memory/learnings/ and indexes it.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The pattern or learning to add (can be multi-line)' },
      source: { type: 'string', description: 'Optional source attribution (defaults to "Oracle Learn")' },
      concepts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional concept tags (e.g., ["git", "safety", "trust"])',
      },
      project: {
        type: 'string',
        description: 'Source project. Accepts: "github.com/owner/repo", "owner/repo", local path with ghq/Code prefix, or GitHub URL. Auto-normalized to "github.com/owner/repo" format.',
      },
    },
    required: ['pattern'],
  },
};

export function normalizeProject(input?: string): string | null {
  if (!input) return null;
  if (input.match(/^github\.com\/[^/]+\/[^/]+$/)) return input.toLowerCase();

  const urlMatch = input.match(/https?:\/\/github\.com\/([^/]+\/[^/]+)/);
  if (urlMatch) return `github.com/${urlMatch[1].replace(/\.git$/, '')}`.toLowerCase();

  const pathMatch = input.match(/github\.com\/([^/]+\/[^/]+)/);
  if (pathMatch) return `github.com/${pathMatch[1]}`.toLowerCase();

  const shortMatch = input.match(/^([^/\s]+\/[^/\s]+)$/);
  return shortMatch ? `github.com/${shortMatch[1]}`.toLowerCase() : null;
}

export function extractProjectFromSource(source?: string): string | null {
  if (!source) return null;
  const oracleLearnMatch = source.match(/from\s+(github\.com\/[^/\s]+\/[^/\s]+)/);
  if (oracleLearnMatch) return oracleLearnMatch[1].toLowerCase();

  const rrrMatch = source.match(/^rrr:\s*([^/\s]+\/[^/\s]+)/);
  if (rrrMatch) return `github.com/${rrrMatch[1]}`.toLowerCase();

  const directMatch = source.match(/(github\.com\/[^/\s]+\/[^/\s]+)/);
  return directMatch ? directMatch[1].toLowerCase() : null;
}

export function errorDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
} {
  if (!(error instanceof Error)) return { name: 'NonError', message: String(error) };
  return {
    name: error.name || 'Error',
    message: error.message,
    ...(error.stack && { stack: error.stack }),
    ...('cause' in error && error.cause !== undefined && { cause: String(error.cause) }),
  };
}
