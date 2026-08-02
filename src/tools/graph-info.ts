/**
 * Graph Info — concept details + fuzzy search.
 *
 * Ported from Oracle v2 Python (oracle-mcp/sources/graph.py).
 */

import type { ToolContext, ToolResponse, GraphInfoInput } from './types.ts';

export const graphInfoToolDef = {
  name: 'arra_graph_info',
  description:
    'Get detailed info about a concept in the knowledge graph: which files reference it, relationship types, and top neighbors. If the exact concept is not found, falls back to fuzzy search.',
  inputSchema: {
    type: 'object',
    properties: {
      concept: {
        type: 'string',
        description: 'Concept name to look up (e.g., "Claude Code", "MCP")',
      },
    },
    required: ['concept'],
  },
};

export async function handleGraphInfo(
  ctx: ToolContext,
  input: GraphInfoInput,
): Promise<ToolResponse> {
  const concept = input.concept;

  const graphTable = ctx.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'graph_edges'").get();
  const edgeCount = graphTable ? ctx.sqlite.prepare('SELECT COUNT(*) as c FROM graph_edges').get() as { c: number } | undefined : undefined;
  if (!edgeCount || edgeCount.c === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Graph not populated.' }) }],
    };
  }

  // Try exact match first
  const rows = ctx.sqlite
    .prepare(
      `SELECT source_path, relationship_type
       FROM graph_edges
       WHERE target_name = ?
       ORDER BY source_path`,
    )
    .all(concept) as Array<{ source_path: string; relationship_type: string }>;

  if (rows.length > 0) {
    const files: Array<{ path: string; type: string }> = [];
    const relCounts: Record<string, number> = {};

    for (const row of rows) {
      files.push({ path: row.source_path, type: row.relationship_type });
      relCounts[row.relationship_type] = (relCounts[row.relationship_type] ?? 0) + 1;
    }

    const neighbors = ctx.sqlite
      .prepare(
        `SELECT g2.target_name, COUNT(DISTINCT g1.source_path) as shared_files
         FROM graph_edges g1
         JOIN graph_edges g2 ON g1.source_path = g2.source_path
         WHERE g1.target_name = ? AND g2.target_name != ?
         GROUP BY g2.target_name
         ORDER BY shared_files DESC
         LIMIT 20`,
      )
      .all(concept, concept) as Array<{ target_name: string; shared_files: number }>;

    const topNeighbors = neighbors.map((n) => ({
      name: n.target_name,
      shared_files: n.shared_files,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              concept,
              found: true,
              total_edges: files.length,
              relationship_types: relCounts,
              files: files.slice(0, 20),
              top_neighbors: topNeighbors,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // Fallback: fuzzy search
  const searchRows = ctx.sqlite
    .prepare(
      `SELECT target_name, COUNT(*) as edge_count
       FROM graph_edges
       WHERE target_name LIKE ?
       GROUP BY target_name
       ORDER BY edge_count DESC
       LIMIT 20`,
    )
    .all(`%${concept}%`) as Array<{ target_name: string; edge_count: number }>;

  if (searchRows.length > 0) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              concept,
              found: false,
              message: `Exact match not found. Did you mean one of these?`,
              suggestions: searchRows.map((r) => ({
                name: r.target_name,
                edge_count: r.edge_count,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ concept, found: false, total_edges: 0 }),
      },
    ],
  };
}
