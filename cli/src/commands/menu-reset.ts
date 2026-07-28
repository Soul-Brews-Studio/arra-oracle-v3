import { sessionApiBase, sessionFetch } from "./session-api.ts";
import { emit } from "./_output.ts";

async function confirm(prompt: string): Promise<boolean> {
  process.stdout.write(`${prompt} `);
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const answer = new TextDecoder().decode(value).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

export async function menuResetAll(args: string[]): Promise<number> {
  const skipConfirm = args.includes("--yes") || args.includes("-y");
  if (!skipConfirm) {
    const ok = await confirm(
      "This will clear all user menu edits and delete custom items. Continue? [y/N]",
    );
    if (!ok) {
      console.error("aborted");
      return 1;
    }
  }

  let res: Response;
  try {
    res = await sessionFetch("/api/menu/reset-all", { method: "POST" });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (!res.ok) {
    console.error(`\x1b[31m✗\x1b[0m POST /api/menu/reset-all failed: HTTP ${res.status}`);
    return 1;
  }
  const body = (await res.json()) as {
    clearedTouched: number;
    deletedCustom: number;
    source: unknown;
  };
  emit({ api: sessionApiBase(), ...body }, args);
  return 0;
}
