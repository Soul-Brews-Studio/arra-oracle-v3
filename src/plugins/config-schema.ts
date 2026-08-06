export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface JsonSchema {
  type?: JsonSchemaType;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
}

export class PluginConfigValidationError extends Error {
  constructor(readonly plugin: string, readonly issues: string[]) {
    super(`Plugin ${plugin} config failed schema validation:\n${issues.map((issue) => ` - ${issue}`).join('\n')}`);
    this.name = 'PluginConfigValidationError';
  }
}

export function validatePluginConfig(config: unknown, schema: unknown, plugin = 'plugin'): void {
  if (!isRecord(schema)) throw new PluginConfigValidationError(plugin, ['configSchema must be a JSON object']);
  const issues: string[] = [];
  validateValue(config, schema as JsonSchema, '$', issues);
  if (issues.length) throw new PluginConfigValidationError(plugin, issues);
}

function validateValue(value: unknown, schema: JsonSchema, path: string, issues: string[]): void {
  if (schema.enum && !schema.enum.some((allowed) => jsonEqual(allowed, value))) {
    issues.push(`${path} must be one of ${schema.enum.map(display).join(', ')}`);
  }
  if (schema.type && !typeMatches(value, schema.type)) {
    issues.push(`${path} must be ${schema.type}`);
    return;
  }
  const objectSchema = schema.type === 'object' || schema.properties || schema.required || schema.additionalProperties === false;
  if (objectSchema) validateObject(value, schema, path, issues);
  if (schema.type === 'array' || schema.items) validateArray(value, schema, path, issues);
}

function validateObject(value: unknown, schema: JsonSchema, path: string, issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be object`);
    return;
  }
  for (const key of schema.required ?? []) {
    if (!(key in value)) issues.push(`${path}.${key} is required`);
  }
  const properties = schema.properties ?? {};
  for (const [key, child] of Object.entries(properties)) {
    if (key in value) validateValue(value[key], child, `${path}.${key}`, issues);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) issues.push(`${path}.${key} is not allowed`);
    }
  }
}

function validateArray(value: unknown, schema: JsonSchema, path: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be array`);
    return;
  }
  if (!schema.items) return;
  value.forEach((item, index) => validateValue(item, schema.items as JsonSchema, `${path}[${index}]`, issues));
}

function typeMatches(value: unknown, type: JsonSchemaType): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function display(value: unknown): string {
  return JSON.stringify(value);
}
