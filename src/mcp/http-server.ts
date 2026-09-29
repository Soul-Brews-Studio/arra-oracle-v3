import { join } from 'node:path';
import type { ToolGroupConfig } from '../config/tool-groups.ts';
import { OracleMCPServer } from './server.ts';
import { emptyHttpPluginRuntime, remoteableMcpToolNames, remoteHttpToolGroups } from './http-policy.ts';
import { loadUnifiedPlugins } from '../plugins/unified-loader.ts';

type Env = Record<string, string | undefined>;

export type HttpOracleMcpServerOptions = {
  env?: Env;
  readOnly?: boolean;
  toolGroups?: ToolGroupConfig;
};

export function createHttpOracleMcpServer(options: HttpOracleMcpServerOptions = {}): OracleMCPServer {
  const env = options.env ?? process.env;
  const privateDeployment = env.ORACLE_PRIVATE_DEPLOYMENT === '1';
  const pluginRoot = env.ORACLE_PRIVATE_PLUGIN_ROOT?.trim() || join(import.meta.dir, '../plugins');
  const unifiedRuntime = privateDeployment
    ? loadUnifiedPlugins({ dirs: [pluginRoot], strict: { root: pluginRoot, requiredNames: ['arra', 'oracle-dig'], failOnLifecycle: true }, warn: (message) => console.error(message) })
    : emptyHttpPluginRuntime();
  return new OracleMCPServer({
    readOnly: options.readOnly ?? env.ORACLE_READ_ONLY === 'true',
    toolGroups: remoteHttpToolGroups(options.toolGroups),
    toolAllowlist: privateDeployment ? [...remoteableMcpToolNames, 'oracle_dig', 'oracle_sessions'] : remoteableMcpToolNames,
    unifiedRuntime,
    installSignalHandlers: false,
  });
}
