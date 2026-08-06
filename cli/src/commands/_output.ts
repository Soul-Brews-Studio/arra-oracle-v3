function scalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value.map(item => {
      if (typeof item === "object" && item !== null) {
        const nested = toYaml(item, indent + 2);
        return `${pad}- ${nested.trimStart()}`;
      }
      return `${pad}- ${scalar(item)}`;
    }).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).map(([key, item]) => {
      if (typeof item === "object" && item !== null) {
        return `${pad}${key}: ${toYaml(item, indent + 2).trimStart()}`;
      }
      return `${pad}${key}: ${scalar(item)}`;
    }).join("\n");
  }
  return `${pad}${scalar(value)}`;
}

export function emit(data: unknown, args: string[]): void {
  const yaml = args.includes("--yml") || args.includes("--yaml");
  if (yaml) {
    const runtimeYaml = (Bun as unknown as { YAML?: { stringify(v: unknown): string } }).YAML;
    const out = runtimeYaml?.stringify(data) ?? toYaml(data);
    process.stdout.write(out.endsWith("\n") ? out : out + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}
