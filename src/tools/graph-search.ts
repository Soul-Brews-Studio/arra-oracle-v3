/**
 * Graph Search — BFS neighbor exploration via shared files.
 *
 * Ported from Oracle v2 Python (oracle-mcp/sources/graph.py).
 * The graph is bipartite: files (source_path) ↔ concepts (target_name).
 * Two concepts are neighbors if they appear in the same file(s).
 */

import type { ToolContext, ToolResponse, GraphSearchInput } from './types.ts';

export const graphSearchToolDef = {
  name: 'arra_graph_search',
  description:
    'Explore the vault knowledge graph. Find concepts connected to a starting concept via shared notes. Use to discover related topics, find knowledge clusters, and understand how ideas connect across the vault.',
  inputSchema: {
    type: 'object',
    properties: {
      concept: {
        type: 'string',
        description: 'Starting concept (e.g., "Claude Code", "Obsidian", "MCP")',
      },
      max_hops: {
        type: 'number',
        description: 'Hops to traverse (1=direct, 2=neighbors of neighbors). Default 1, max 3',
      },
      relationship_types: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Filter: body_wikilink, keyword, topic_hierarchy, source_reference, related_note, yaml_wikilink',
      },
      limit: {
        type: 'number',
        description: 'Max neighbors per hop (default 20)',
      },
    },
    required: ['concept'],
  },
};

export async function handleGraphSearch(
  ctx: ToolContext,
  input: GraphSearchInput,
): Promise<ToolResponse> {
  const concept = input.concept;
  const maxHops = Math.min(input.max_hops ?? 1, 3);
  const limit = input.limit ?? 20;
  const relTypes = input.relationship_types;

  const edgeCount = ctx.sqlite.prepare('SELECT COUNT(*) as c FROM graph_edges').get() as { c: number } | undefined;
  if (!edgeCount || edgeCount.c === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Graph not populated. Copy graph_edges from Oracle v2 or run a vault graph builder.' }) }],
    };
  }

  const visited = new Set<string>([concept]);
  let frontier: string[] = [concept];
  const allNodes: Array<{ name: string; hop: number; weight?: number }> = [{ name: concept, hop: 0 }];
  const allEdges: Array<{ from: string; to: string; weight: number; hop: number }> = [];

  for (let hop = 1; hop <= maxHops; hop++) {
    if (frontier.length === 0 || visited.size > 500) break;

    const phF = frontier.map(() => '?').join(',');
    const phV = Array.from(visited).map(() => '?').join(',');
    const params: (string | number)[] = [...frontier];

    let relFilter = '';
    if (relTypes && relTypes.length > 0) {
      const phR = relTypes.map(() => '?').join(',');
      relFilter = `AND g2.relationship_type IN (${phR})`;
      params.push(...relTypes);
    }

    params.push(...Array.from(visited));
    params.push(limit);

    const query = `
      SELECT g2.target_name, COUNT(DISTINCT g1.source_path) as shared_files
      FROM graph_edges g1
      JOIN graph_edges g2 ON g1.source_path = g2.source_path
      WHERE g1.target_name IN (${phF})
        ${relFilter}
        AND g2.target_name NOT IN (${phV})
      GROUP BY g2.target_name
      ORDER BY shared_files DESC
      LIMIT ?
    `;

    const rows = ctx.sqlite.prepare(query).all(...params) as Array<{
      target_name: string;
      shared_files: number;
    }>;

    const newFrontier: string[] = [];
    for (const row of rows) {
      newFrontier.push(row.target_name);
      visited.add(row.target_name);
      allNodes.push({ name: row.target_name, hop, weight: row.shared_files });
      allEdges.push({
        from: hop === 1 ? concept : `hop${hop - 1}`,
        to: row.target_name,
        weight: row.shared_files,
        hop,
      });
    }

    frontier = newFrontier;
  }

  const result = {
    start: concept,
    hops_completed: maxHops,
    nodes: allNodes,
    total_nodes: allNodes.length,
    total_edges: allEdges.length,
  };

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}
