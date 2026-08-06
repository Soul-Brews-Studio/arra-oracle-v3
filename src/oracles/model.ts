export interface OracleCapability {
  id: string;
  label: string;
  description: string;
}

export interface OracleProfile {
  id: string;
  slug: string;
  name: string;
  role: string;
  theme: string;
  born: string;
  human?: string;
  motto: string;
  principles: string[];
  capabilities: OracleCapability[];
  workflows: string[];
  defaultConcepts: string[];
}

export interface StormforgeEvidence {
  path?: string;
  title?: string;
  url?: string;
  summary: string;
}

export interface StormforgeFinding {
  issue?: number;
  repo?: string;
  title?: string;
  question?: string;
  repoEvidence?: StormforgeEvidence[];
  externalSources?: StormforgeEvidence[];
  hypotheses?: string[];
  recommendation?: string;
  implementationPlan?: string[];
  verificationPlan?: string[];
  openQuestions?: string[];
}
