/**
 * Dispatch for the vault + local DB + hub commands of issue #3110.
 *
 * cli.ts routes here in one line (it sits at its line budget). Every command except `init`
 * is a thin caller of the HTTP API, so CLI, MCP and skills always agree.
 */

import { initCommand, statusCommand } from "./init-status.ts";

type Handler = (args: string[]) => Promise<number>;

const HANDLERS: Record<string, Handler> = {
  init: initCommand,
  status: statusCommand,
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
