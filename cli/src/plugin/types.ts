export interface PluginManifest {
  name: string;
  version: string;
  entry: string;
  sdk: string;
  weight?: number;
  description?: string;
  author?: string;
  tier?: "core" | "standard" | "extra";
  enabled?: boolean;
  seedMenu?: boolean;
  cli?: {
    command: string;
    aliases?: string[];
    help?: string;
    flags?: Record<string, string>;
  };
  api?: {
    path: string;
    methods?: string[];
  };
  lifecycle?: {
    start?: boolean;
    stop?: boolean;
  };
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  entryPath: string;
}

export interface InvokeContext {
  source: "cli" | "api" | "peer" | "lifecycle";
  args: string[];
  request?: Request;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  lifecycle?: "start" | "stop";
  server?: {
    dataDir: string;
    vectorUrl?: string;
    signal: AbortSignal;
    logger?: {
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };
  };
  writer?: (...args: unknown[]) => void;
}

export interface InvokeResult {
  ok: boolean;
  output?: string;
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}
