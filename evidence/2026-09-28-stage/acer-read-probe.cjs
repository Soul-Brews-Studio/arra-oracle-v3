// Read-only restricted bridge acceptance; run with Node on Acer.
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const p = spawn('C:\\Program Files\\Git\\usr\\bin\\ssh.exe', [
  '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
  '-o', 'UpdateHostKeys=no', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10',
  '-i', process.env.USERPROFILE + '\\.ssh\\id_ed25519_arra_mint',
  'poramateake@100.109.242.66',
]);
let seq = 0;
const pending = new Map();
readline.createInterface({ input: p.stdout }).on('line', line => {
  try { const v = JSON.parse(line); pending.get(v.id)?.(v); pending.delete(v.id); }
  catch { /* Ignore non-protocol diagnostic lines. */ }
});
p.stderr.pipe(process.stderr);
const call = (method, params) => new Promise(resolve => {
  const id = ++seq; pending.set(id, resolve);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const body = response => {
  if (response.error || response.result?.isError) throw Error('MCP call failed');
  return JSON.parse(response.result.content.find(c => c.type === 'text').text);
};
const timer = setTimeout(() => { p.kill(); process.exit(1); }, 90000);
(async () => {
  try {
    const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acer-read-gate', version: '1' } });
    if (init.error) throw Error('Initialize failed');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await call('tools/list', {});
    const names = list.result.tools.map(t => t.name).sort();
    const expected = ['oracle_search', 'oracle_read', 'oracle_list', 'oracle_learn', 'oracle_reflect'].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw Error('Restricted catalogue mismatch');
    const search = body(await call('tools/call', { name: 'oracle_search', arguments: { query: 'backup', mode: 'fts', limit: 1 } }));
    const id = search.results?.[0]?.id;
    if (!id) throw Error('No search result');
    const read = body(await call('tools/call', { name: 'oracle_read', arguments: { id } }));
    if (read.error) throw Error('Read failed');
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), tools: names, search: 'passed', id, read: 'passed' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { clearTimeout(timer); p.stdin.end(); p.kill(); }
})();
