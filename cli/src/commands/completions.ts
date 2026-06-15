import type { CommandSpec } from "./catalog.ts";
import { BUILTIN_COMMANDS, COMMON_FLAGS } from "./catalog.ts";
import { discoverPlugins } from "../plugin/loader.ts";
import { pluginCliCommands } from "../plugin/registry.ts";

function uniq(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean).sort();
}

function shellWords(values: string[]): string {
  return uniq(values).join(" ");
}

function shQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function zshWords(commands: CommandSpec[]): string {
  return uniq(commands.map(c => shQuote(`${c.command}:${c.help.replace(/[:\\]/g, " ")}`))).join(" ");
}

export async function getCompletionCommandSpecs(): Promise<CommandSpec[]> {
  const discovered = await discoverPlugins();
  const pluginCommands = discovered.plugins
    .flatMap(pluginCliCommands)
    .map((c): CommandSpec => ({
      command: c.command,
      help: c.help ?? c.plugin.manifest.description ?? "ARRA command",
      flags: Object.keys(c.flags ?? {}),
    }));
  const byCommand = new Map<string, CommandSpec>();
  for (const spec of [...BUILTIN_COMMANDS, ...pluginCommands]) byCommand.set(spec.command, spec);
  return [...byCommand.values()].sort((a, b) => a.command.localeCompare(b.command));
}

function bash(specs: CommandSpec[]): string {
  const commands = shellWords(specs.map(s => s.command));
  const flags = shellWords(COMMON_FLAGS);
  const subcase = specs
    .filter(s => s.subcommands?.length)
    .map(s => `    ${s.command}) COMPREPLY=( $(compgen -W "${shellWords([...(s.subcommands ?? []), ...(s.flags ?? [])])}" -- "$cur") ) ;;`)
    .join("\n");
  return `# bash completion for arra/arra-cli\n_arra_completion() {\n  local cur prev cmd\n  COMPREPLY=()\n  cur="\${COMP_WORDS[COMP_CWORD]}"\n  prev="\${COMP_WORDS[COMP_CWORD-1]}"\n\n  if [[ $COMP_CWORD -eq 1 ]]; then\n    COMPREPLY=( $(compgen -W "${commands} ${flags}" -- "$cur") )\n    return 0\n  fi\n\n  cmd="\${COMP_WORDS[1]}"\n  case "$cmd" in\n${subcase}\n    *) COMPREPLY=( $(compgen -W "${flags}" -- "$cur") ) ;;\n  esac\n}\ncomplete -F _arra_completion arra\ncomplete -F _arra_completion arra-cli\n`;
}

function zsh(specs: CommandSpec[]): string {
  const top = zshWords(specs);
  const flags = shellWords(COMMON_FLAGS);
  const subcase = specs
    .filter(s => s.subcommands?.length)
    .map(s => `    ${s.command}) _values '${s.command}' ${shellWords([...(s.subcommands ?? []), ...(s.flags ?? [])])} ;;`)
    .join("\n");
  return `#compdef arra arra-cli\n# zsh completion for arra/arra-cli\n_arra() {\n  local -a commands\n  commands=(${top})\n\n  if (( CURRENT == 2 )); then\n    _describe 'command' commands\n    _values 'global flags' ${flags}\n    return\n  fi\n\n  case "\${words[2]}" in\n${subcase}\n    *) _values 'flags' ${flags} ;;\n  esac\n}\n_arra "$@"\n`;
}

function fish(specs: CommandSpec[]): string {
  const lines = ["# fish completion for arra/arra-cli"];
  for (const bin of ["arra", "arra-cli"]) {
    for (const spec of specs) {
      lines.push(`complete -c ${bin} -f -n '__fish_use_subcommand' -a '${spec.command}' -d '${spec.help.replace(/'/g, "").replace(/\n/g, " ")}'`);
      for (const sub of spec.subcommands ?? []) {
        lines.push(`complete -c ${bin} -f -n '__fish_seen_subcommand_from ${spec.command}' -a '${sub}'`);
      }
    }
    for (const flag of COMMON_FLAGS) {
      if (flag.startsWith("--")) lines.push(`complete -c ${bin} -f -l ${flag.slice(2)} -d '${flag}'`);
      else if (flag.startsWith("-") && flag.length === 2) lines.push(`complete -c ${bin} -f -s ${flag.slice(1)} -d '${flag}'`);
    }
  }
  return lines.join("\n") + "\n";
}

export async function completionsCommand(args: string[]): Promise<number> {
  const shell = args[0]?.toLowerCase();
  if (!shell || shell === "--help" || shell === "-h") {
    console.log("usage: arra completions <bash|zsh|fish>");
    return shell ? 0 : 1;
  }
  const specs = await getCompletionCommandSpecs();
  if (shell === "bash") console.log(bash(specs));
  else if (shell === "zsh") console.log(zsh(specs));
  else if (shell === "fish") console.log(fish(specs));
  else {
    console.error(`unknown shell: ${args[0]}`);
    console.error("usage: arra completions <bash|zsh|fish>");
    return 1;
  }
  return 0;
}
