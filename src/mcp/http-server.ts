import type { ToolGroupConfig } from '../config/tool-groups.ts';
import { OracleMCPServer } from './server.ts';
import { emptyHttpPluginRuntime, remoteableMcpToolNames, remoteHttpToolGroups } from './http-policy.ts';

type Env = Record<string, string | undefined>;

export type HttpOracleMcpServerOptions = {
  env?: Env;
  readOnly?: boolean;
  toolGroups?: ToolGroupConfig;
};

export function createHttpOracleMcpServer(options: HttpOracleMcpServerOptions = {}): OracleMCPServer {
  const env = options.env ?? process.env;
  return new OracleMCPServer({
    readOnly: options.readOnly ?? env.ORACLE_READ_ONLY === 'true',
    toolGroups: remoteHttpToolGroups(options.toolGroups),
    toolAllowlist: remoteableMcpToolNames,
    unifiedRuntime: emptyHttpPluginRuntime(),
    installSignalHandlers: false,
  });
}
