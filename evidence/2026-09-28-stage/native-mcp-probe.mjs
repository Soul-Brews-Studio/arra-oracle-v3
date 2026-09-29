// Run inside the Arra container with its existing protected environment.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base = `http://127.0.0.1:${process.env.ORACLE_PORT || 47778}`;
const client = new Client({ name: 'private-native-mcp-gate', version: '1' });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.ORACLE_MCP_HTTP_TOKEN || process.env.ARRA_API_TOKEN}` } },
});
const parse = result => {
  if (result.isError) throw Error('MCP tool returned error');
  return JSON.parse(result.content.find(c => c.type === 'text').text);
};
try {
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(t => t.name).sort();
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), tools: names }));
  const search = parse(await client.callTool({ name: 'oracle_search', arguments: { query: 'backup recovery', mode: 'hybrid', limit: 2 } }));
  console.log(JSON.stringify({ gate: 'default-hybrid', metadata: search.metadata, ids: search.results?.map(r => r.id) }));
  if (!(search.metadata?.vectorMatches > 0) || search.metadata?.warning) throw Error('Default hybrid failed');
  const read = parse(await client.callTool({ name: 'oracle_read', arguments: { id: search.results[0].id } }));
  if (read.error) throw Error('Read failed');
  console.log(JSON.stringify({ gate: 'read', result: 'passed' }));
  const started = Date.now();
  const ask = parse(await client.callTool({ name: 'oracle_ask', arguments: { question: 'What is the Arra backup and recovery policy?', llm: true, limit: 3 } }, undefined, { timeout: 90000 }));
  console.log(JSON.stringify({ gate: 'ask', elapsedMs: Date.now() - started, mode: ask.mode, noEvidence: ask.noEvidence, citations: ask.citations?.length, answerPresent: typeof ask.answer === 'string' }));
  if (ask.mode !== 'llm' || typeof ask.answer !== 'string' || !ask.citations?.length || ask.noEvidence) throw Error('Live cited LLM ask failed');
} finally { await client.close(); }
