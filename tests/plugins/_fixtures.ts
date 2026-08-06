import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";

export function pluginDir(base: string, dirName: string, manifest: Record<string, unknown>, entry = "") {
  const dir = join(base, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({
    name: dirName,
    version: "1.0.0",
    entry: "./index.ts",
    ...manifest,
  }, null, 2));
  writeFileSync(join(dir, "index.ts"), entry || "export default () => ({ ok: true });\n");
  return dir;
}

export async function handleWith(routes: unknown[], request: Request): Promise<Response> {
  const app = new Elysia();
  for (const route of routes) app.use(route as never);
  return await app.handle(request);
}
