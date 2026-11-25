/** Help for the vault + local DB + hub commands (#3110). Kept apart: help-entries.ts is near its line budget. */
import type { CliHelpEntry } from "./help-entries.ts";

export const ARRA_VAULT_HELP: CliHelpEntry[] = [
  { command: "init", help: "make <dir>/.arra a local arra (schema, ψ indexed, .gitignore, .envrc)", usage: "arra init [dir] [--name n] [--vault <path> --vault-name <org>] [--hub --name <hub>] [--from <old data dir>] [--reindex] [--json]", examples: ["arra init .", "arra init ~/hub --hub --name soul-brews --vault ~/org-vault"] },
  { command: "status", help: "this arra: data dir, docs per source, vaults, hubs, embedder, snapshots", usage: "arra status [--json]", examples: ["arra status"] },
  { command: "share", help: "write one note into an org vault (or through a joined hub) and commit it", usage: "arra share <doc-id|file.md> | --text \"..\" [--vault <org>|hub:<org>] [--title T] [--json]", examples: ["arra share --text \"# Glaze recipe ...\" --vault hub:soul-brews"] },
  { command: "sync", help: "pull connected vaults and joined hubs, index them as hub:<name>", usage: "arra sync [<vault>] [--json]", examples: ["arra sync"] },
  { command: "snapshot", help: "manual vector snapshots keyed by model + vault commit", usage: "arra snapshot create|push <dir|hub:org>|pull <dir|file|hub:org>|list [--json]", examples: ["arra snapshot create", "arra snapshot pull hub:soul-brews"] },
  { command: "find", help: "search grouped by source (self, hub:<name>); self: / shared: narrow", usage: "arra find \"<query>\" [--limit N] [--json]", examples: ["arra find glaze", "arra find shared:glaze"] },
  { command: "open", help: "open one document by id (local copy, else the hub it came from)", usage: "arra open <id> [--json]", examples: ["arra open hub:soul-brews:ψ/memory/shared/2026-11-24_glaze-recipe.md"] },
  { command: "hub", help: "hub door: invite codes, joined nodes, revoke", usage: "arra hub invite [--for 15m|1h|7d|forever] [--label x] | nodes | revoke <id> [--why ..] [--successor x]", examples: ["arra hub invite --for 15m --label guest", "arra hub nodes", "arra hub revoke node-a-f0b9 --why \"left\""] },
  { command: "join", help: "join a hub on the tailnet/LAN with a one-use code", usage: "arra join <hub url> --code <code> [--label name] [--json]", examples: ["arra join http://hub.example.ts.net:47778 --code ABCD-EFGH-JKMN"] },
  { command: "hubs", help: "hubs this arra joined; --leave drops a token locally", usage: "arra hubs [--leave <name>] [--json]", examples: ["arra hubs"] },
  { command: "discover", help: "find arra hubs on the tailnet", usage: "arra discover [--port N] [--hosts a,b] [--json]", examples: ["arra discover"] },
  { command: "retire", help: "cease by hand: a RETIRED.md row in the vault (nothing is deleted)", usage: "arra retire <thing> --successor <x|nothing> --why \"..\" [--back \"..\"]", examples: ["arra retire \"snapshot lancedb-none-9ba3ef49a1cd\" --successor nothing --why \"vault moved on\""] },
];
