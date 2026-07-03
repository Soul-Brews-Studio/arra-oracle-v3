export type Step = 0 | 1 | 2 | 3;
export type VectorIndexSource = 'auto' | 'vault' | 'sqlite';
export type Stats = {
  total?: number;
  total_docs?: number;
  vector?: { enabled?: boolean; count?: number };
};
export type VectorConfig = {
  source?: "file" | "defaults";
  resolution?: {
    providerPrompt?: boolean;
    wizard?: "optional" | "required" | "advanced";
    engine?: string;
  };
  config?: {
    collections?: Record<
      string,
      {
        enabled?: boolean;
        collection?: string;
        model?: string;
        provider?: string;
      }
    >;
    embedder?: Record<string, unknown>;
  };
  doc_counts?: Record<string, number>;
};
export type Provider = {
  type: string;
  available?: boolean;
  configured?: boolean;
  models?: string[];
  status?: string;
  error?: string;
};
