export function emit(data: unknown, args: string[]): void {
  const yaml = args.includes("--yml") || args.includes("--yaml");
  if (yaml) {
    const out = (Bun as any).YAML.stringify(data);
    process.stdout.write(out.endsWith("\n") ? out : out + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}
