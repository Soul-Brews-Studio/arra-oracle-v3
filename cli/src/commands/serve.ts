export { serveCommand } from "../../../src/cli/commands/serve.ts";

export type ServeDelegate =
  | { kind: "delegate"; args: string[] }
  | { kind: "foreground" }
  | { kind: "error"; message: string };

function hasBothRunModes(flags: string[]): boolean {
  const hasForeground = flags.includes("--foreground") || flags.includes("-f");
  const hasBackground = flags.includes("--background") || flags.includes("-b");
  return hasForeground && hasBackground;
}

function delegateForStart(rawArgs: string[]): ServeDelegate {
  const runArgs = [...rawArgs];
  if (hasBothRunModes(runArgs)) {
    return { kind: "error", message: "Cannot use --foreground and --background together" };
  }

  if (runArgs.includes("foreground") || runArgs.includes("--foreground") || runArgs.includes("-f")) {
    return { kind: "foreground" };
  }

  return { kind: "delegate", args: runArgs };
}

export function serveCommandPlan(args: string[]): ServeDelegate {
  if (args[0] !== "serve") {
    return { kind: "error", message: "Usage: arra serve [start|status|stop]" };
  }

  const sub = args[1];
  const rest = args.slice(2);

  if (!sub) {
    return { kind: "delegate", args: [] };
  }

  if (sub === "foreground") {
    return { kind: "foreground" };
  }

  if (sub === "status" || sub === "stop") {
    return { kind: "delegate", args: [sub, ...rest] };
  }

  if (sub === "start") {
    return delegateForStart(rest);
  }

  if (sub === "daemon" || sub === "background" || sub === "bg") {
    return delegateForStart(["start", ...rest]);
  }

  return { kind: "error", message: `Unknown serve subcommand: ${sub}` };
}
