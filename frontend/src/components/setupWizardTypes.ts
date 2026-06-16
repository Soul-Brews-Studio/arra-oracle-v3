export type Step = 0 | 1 | 2 | 3;
export type Stats = {
  total?: number;
  total_docs?: number;
  vector?: { enabled?: boolean; count?: number };
};
export type VectorConfig = {
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
