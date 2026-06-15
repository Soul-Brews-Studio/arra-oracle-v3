import { menuList } from "./menu-list.ts";
import { menuAdd } from "./menu-add.ts";
import { menuRemove } from "./menu-remove.ts";
import {
  menuGistStatus,
  menuGistUrl,
  menuGistClear,
  menuGistReload,
} from "./menu-gist.ts";
import { menuResetAll } from "./menu-reset.ts";

function printMenuHelp(): void {
  console.log("arra-cli menu <subcommand>\n");
  console.log("Subcommands:");
  console.log("  list [--custom]                         list menu items (JSON array)");
  console.log("  add --path /p --label L [--group g] [--order N] [--icon i]");
  console.log("                                          add or replace a custom menu item");
  console.log("  remove <path>                           remove a custom menu item");
  console.log("  gist-status                             show current gist source");
  console.log("  gist-url <url> [--override]             set gist URL (merge|override)");
  console.log("  gist-clear                              clear gist URL");
  console.log("  gist-reload                             force refetch of gist menu");
  console.log("  reset-all [--yes]                       nuclear reset (prompts y/N)");
  console.log("\nOutput defaults to JSON; pass --yml for YAML.");
  console.log("\nEnv:");
  console.log("  ORACLE_API          API base URL (default http://localhost:47778)");
}

export async function menuCommand(args: string[]): Promise<number> {
  const sub = args[0]?.toLowerCase();
  const rest = args.slice(1);
  if (sub === "list" || sub === "ls") return await menuList(rest);
  if (sub === "add") return await menuAdd(rest);
  if (sub === "remove" || sub === "rm") return await menuRemove(rest);
  if (sub === "gist-status") return await menuGistStatus(rest);
  if (sub === "gist-url") return await menuGistUrl(rest);
  if (sub === "gist-clear") return await menuGistClear(rest);
  if (sub === "gist-reload") return await menuGistReload(rest);
  if (sub === "reset-all") return await menuResetAll(rest);
  if (!sub || sub === "--help" || sub === "-h") {
    printMenuHelp();
    return 0;
  }
  console.error(`\x1b[31m✗\x1b[0m unknown menu subcommand: ${args[0]}`);
  console.error("  try: arra-cli menu list|add|remove|gist-*|reset-all");
  return 1;
}
