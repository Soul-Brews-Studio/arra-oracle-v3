/**
 * Graph Path — BFS shortest path between two concepts.
 *
 * Ported from Oracle v2 Python (oracle-mcp/sources/graph.py).
 */

import type { ToolContext, ToolResponse, GraphPathInput } from './types.ts';

export const graphPathToolDef = {
  name: 'arra_graph_path',
  description:
    'Find the shortest path between two concepts in the vault knowledge graph. Shows how ideas connect through shared notes.',
  inputSchema: {
    type: 'object',
    properties: {
      from_concept: {
        type: 'string',
        description: 'Starting concept',
      },
      to_concept: {
        type: 'string',
        description: 'Target concept',
      },
      max_depth: {
        type: 'number',
        description: 'Maximum path length (default 4, max 6)',
      },
    },
    required: ['from_concept', 'to_concept'],
  },
};

function getNeighborsForPath(
  ctx: ToolContext,
  concept: string,
  visited: Set<string>,
  limit: number = 30,
): Array<{ name: string; weight: number }> {
  const phV = Array.from(visited).map(() => '?').join(',');
  const params: (string | number)[] = [concept, ...Array.from(visited), limit];

  const rows = ctx.sqlite
    .prepare(
      `SELECT g2.target_name, COUNT(DISTINCT g1.source_path) as shared_files
       FROM graph_edges g1
       JOIN graph_edges g2 ON g1.source_path = g2.source_path
       WHERE g1.target_name = ?
         AND g2.target_name NOT IN (${phV})
       GROUP BY g2.target_name
       ORDER BY shared_files DESC
       LIMIT ?`,
    )
    .all(...params) as Array<{ target_name: string; shared_files: number }>;

  return rows.map((r) => ({ name: r.target_name, weight: r.shared_files }));
}

function buildPathDetails(
  ctx: ToolContext,
  pathList: string[],
): Array<{ from: string; to: string; shared_files: number }> {
  const details: Array<{ from: string; to: string; shared_files: number }> = [];
  for (let i = 0; i < pathList.length - 1; i++) {
    const row = ctx.sqlite
      .prepare(
        `SELECT COUNT(DISTINCT g1.source_path) as shared_files
         FROM graph_edges g1
         JOIN graph_edges g2 ON g1.source_path = g2.source_path
         WHERE g1.target_name = ? AND g2.target_name = ?`,
      )
      .get(pathList[i], pathList[i + 1]) as { shared_files: number } | undefined;

    details.push({
      from: pathList[i],
      to: pathList[i + 1],
      shared_files: row?.shared_files ?? 0,
    });
  }
  return details;
}

export async function handleGraphPath(
  ctx: ToolContext,
  input: GraphPathInput,
): Promise<ToolResponse> {
  const from = input.from_concept;
  const to = input.to_concept;
  const maxDepth = Math.min(input.max_depth ?? 4, 6);

  const edgeCount = ctx.sqlite.prepare('SELECT COUNT(*) as c FROM graph_edges').get() as { c: number } | undefined;
  if (!edgeCount || edgeCount.c === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Graph not populated.' }) }],
    };
  }

  if (from === to) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ found: true, path: [from], depth: 0 }) }],
    };
  }

  const visited = new Set<string>([from]);
  const queue: Array<{ current: string; path: string[] }> = [{ current: from, path: [from] }];
  let totalVisited = 0;

  while (queue.length > 0 && totalVisited < 500) {
    const item = queue.shift()!;
    if (item.path.length > maxDepth) continue;

    const neighbors = getNeighborsForPath(ctx, item.current, visited);
    totalVisited += neighbors.length;

    for (const neighbor of neighbors) {
      const newPath = [...item.path, neighbor.name];
      if (neighbor.name === to) {
        const pathDetails = buildPathDetails(ctx, newPath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { found: true, from, to, path: newPath, path_details: pathDetails, depth: newPath.length - 1 },
                null,
                2,
              ),
            },
          ],
        };
      }
      visited.add(neighbor.name);
      if (newPath.length <= maxDepth) {
        queue.push({ current: neighbor.name, path: newPath });
      }
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { found: false, from, to, searched_depth: maxDepth, nodes_visited: totalVisited },
          null,
          2,
        ),
      },
    ],
  };
}
