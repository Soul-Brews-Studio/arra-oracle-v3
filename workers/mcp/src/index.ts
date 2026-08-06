import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type OracleMcpAuthContext, type OracleProxyEnv } from './proxy.ts';
import { registerOracleMcpTools } from './tools.ts';

type Env = OracleProxyEnv;

export class OracleMCP extends McpAgent<Env, unknown, OracleMcpAuthContext> {
  server = new McpServer({ name: 'arra-oracle', version: '1.0.0' });

  async init() {
    registerOracleMcpTools(this.server, z, this.env, this.props);
  }
}

export default OracleMCP.serve('/mcp');
