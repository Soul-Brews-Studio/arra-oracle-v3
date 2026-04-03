import type { GraphNode, GraphLink } from './graphTypes';

/** Simple clustering: group nodes by shared links via BFS */
export function clusterNodes(nodes: GraphNode[], links: GraphLink[]): Map<string, number> {
  const clusters = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  // Build adjacency list
  nodes.forEach(n => adjacency.set(n.id, new Set()));
  links.forEach(link => {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  });

  // Assign clusters based on most connected neighbor groups
  let clusterCount = 0;
  const visited = new Set<string>();

  // Sort by connection count (most connected first)
  const sortedNodes = [...nodes].sort((a, b) =>
    (adjacency.get(b.id)?.size || 0) - (adjacency.get(a.id)?.size || 0)
  );

  sortedNodes.forEach(node => {
    if (visited.has(node.id)) return;

    // BFS to find cluster members
    const queue = [node.id];
    const clusterMembers: string[] = [];

    while (queue.length > 0 && clusterMembers.length < 50) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      clusterMembers.push(current);

      const neighbors = adjacency.get(current) || new Set();
      neighbors.forEach(n => {
        if (!visited.has(n)) queue.push(n);
      });
    }

    clusterMembers.forEach(id => clusters.set(id, clusterCount));
    clusterCount++;
  });

  return clusters;
}
