import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

export function seedOraclePlugin(home: string, name: string, manifest: Record<string, unknown>): void {
  const dir = join(home, ".oracle", "plugins", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name, ...manifest }, null, 2));
}
