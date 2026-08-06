function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateFanoutCost(query: string, collections: string[]) {
  const inputTokens = estimateTokens(query);
  const vectorQueries = collections.length;
  return {
    inputTokens,
    vectorQueries,
    embeddingCalls: vectorQueries,
    estimatedTokenUnits: inputTokens * vectorQueries,
    estimatedUsd: 0,
    note: 'Local vector collections have no metered API cost; token units estimate remote embedder exposure.',
  };
}
