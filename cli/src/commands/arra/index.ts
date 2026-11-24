/**
 * Dispatch for the vault + local DB + hub commands of issue #3110.
 *
 * cli.ts routes here in one line (it sits at its line budget). Every command except `init`
 * is a thin caller of the HTTP API, so CLI, MCP and skills always agree.
 */

import { initCommand, statusCommand } from "./init-status.ts";
import { shareCommand, snapshotCommand, syncCommand } from "./vault.ts";
import { findCommand, openCommand } from "./search-read.ts";
import { discoverCommand, hubCommand, hubsCommand, joinCommand, retireCommand, serveHubCommand } from "./hub.ts";

type Handler = (args: string[]) => Promise<number>;

const HANDLERS: Record<string, Handler> = {
  init: initCommand,
  status: statusCommand,
  share: shareCommand,
  sync: syncCommand,
  snapshot: snapshotCommand,
  find: findCommand,
  search: findCommand,
  open: openCommand,
  read: openCommand,
  hub: hubCommand,
  join: joinCommand,
  hubs: hubsCommand,
  discover: discoverCommand,
  retire: retireCommand,
  serve: serveHubCommand,
};

export const ARRA_COMMANDS = Object.keys(HANDLERS);

export async function runArraCommand(cmd: string, args: string[]): Promise<number> {
  const handler = HANDLERS[cmd];
  if (!handler) {
    console.error(`unknown arra command: ${cmd}`);
    return 1;
  }
  return handler(args);
}
