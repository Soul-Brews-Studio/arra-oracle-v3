import type { ToolGroupConfig } from '../../../src/config/tool-groups.ts';
import { OracleMCPServer } from '../../../src/mcp/server.ts';

export const allToolGroups: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  oracle: true,
  trace: true,
  standalone: true,
};

export function withProxyServer(options: ConstructorParameters<typeof OracleMCPServer>[0] = {}) {
  process.env.ORACLE_HTTP_URL = 'http://127.0.0.1:1';
  return new OracleMCPServer({ toolGroups: allToolGroups, ...options });
}

export function callToolHandler(server: OracleMCPServer) {
  const raw = (server as any).server._requestHandlers.get('tools/call') as (request: unknown) => Promise<any>;
  return (request: any) => raw({ method: 'tools/call', ...request });
}

export function listToolsHandler(server: OracleMCPServer) {
  const raw = (server as any).server._requestHandlers.get('tools/list') as (request: unknown) => Promise<any>;
  return () => raw({ method: 'tools/list', params: {} });
}
