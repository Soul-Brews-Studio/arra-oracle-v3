import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function repoRoot(): string {
  const root = process.env.ORACLE_ROOT?.trim();
  if (!root) throw new Error('ORACLE_ROOT is required for maw arra serve');
  return root;
}

function applyPortArg(args: string[]): void {
  const index = args.indexOf('--port');
  if (index < 0) return;
  const port = args[index + 1];
  if (!port || !/^\d+$/.test(port)) throw new Error('--port requires a numeric value');
  process.env.ORACLE_PORT = port;
  process.env.PORT = port;
}

applyPortArg(process.argv.slice(2));
const root = repoRoot();
const moduleUrl = pathToFileURL(join(root, 'src/server.ts')).href;
const { startServer } = await import(moduleUrl);
const server = await startServer();
console.log(`🔮 maw arra plugin backend → http://localhost:${server.port}`);
