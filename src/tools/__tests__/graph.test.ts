import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handleGraphSearch } from '../graph-search.ts';
import { handleGraphPath } from '../graph-path.ts';
import { handleGraphInfo } from '../graph-info.ts';
import type { ToolContext } from '../types.ts';

// Only `sqlite` is exercised by the graph handlers; the rest of ToolContext is unused.
const contextFor = (sqlite: Database) => ({ sqlite }) as unknown as ToolContext;

const parse = (text: string) => JSON.parse(text);

describe('graph handlers without a graph_edges table', () => {
  test('graph-search returns "not populated" instead of throwing', async () => {
    const sqlite = new Database(':memory:');
    const resp = await handleGraphSearch(contextFor(sqlite), { concept: 'X' });
    expect(parse(resp.content[0].text).error).toContain('Graph not populated');
    sqlite.close();
  });

  test('graph-path returns "not populated" instead of throwing', async () => {
    const sqlite = new Database(':memory:');
    const resp = await handleGraphPath(contextFor(sqlite), { from_concept: 'A', to_concept: 'B' });
    expect(parse(resp.content[0].text).error).toContain('Graph not populated');
    sqlite.close();
  });

  test('graph-info returns "not populated" instead of throwing', async () => {
    const sqlite = new Database(':memory:');
    const resp = await handleGraphInfo(contextFor(sqlite), { concept: 'X' });
    expect(parse(resp.content[0].text).error).toContain('Graph not populated');
    sqlite.close();
  });
});

describe('graph handlers with a populated graph_edges table', () => {
  const seed = () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE graph_edges (
        source_path TEXT NOT NULL,
        target_name TEXT NOT NULL,
        relationship_type TEXT NOT NULL
      );
      INSERT INTO graph_edges (source_path, target_name, relationship_type) VALUES
        ('note-1.md', 'Claude Code', 'body_wikilink'),
        ('note-1.md', 'Obsidian', 'body_wikilink'),
        ('note-2.md', 'Obsidian', 'body_wikilink'),
        ('note-2.md', 'MCP', 'keyword');
    `);
    return sqlite;
  };

  test('graph-search finds neighbors via shared notes', async () => {
    const sqlite = seed();
    const resp = await handleGraphSearch(contextFor(sqlite), { concept: 'Claude Code', max_hops: 1 });
    const result = parse(resp.content[0].text);
    expect(result.nodes.map((node: { name: string }) => node.name)).toContain('Obsidian');
    sqlite.close();
  });

  test('graph-path finds a direct path through a shared note', async () => {
    const sqlite = seed();
    const resp = await handleGraphPath(contextFor(sqlite), { from_concept: 'Claude Code', to_concept: 'MCP' });
    const result = parse(resp.content[0].text);
    expect(result.found).toBe(true);
    expect(result.path[0]).toBe('Claude Code');
    expect(result.path.at(-1)).toBe('MCP');
    sqlite.close();
  });

  test('graph-info reports edges and neighbors for a concept', async () => {
    const sqlite = seed();
    const resp = await handleGraphInfo(contextFor(sqlite), { concept: 'Obsidian' });
    const result = parse(resp.content[0].text);
    expect(result.found).toBe(true);
    expect(result.total_edges).toBe(2);
    expect(result.top_neighbors.map((neighbor: { name: string }) => neighbor.name)).toContain('Claude Code');
    sqlite.close();
  });
});
