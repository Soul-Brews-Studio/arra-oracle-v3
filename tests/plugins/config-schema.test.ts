import { describe, expect, test } from "bun:test";
import {
  PluginConfigValidationError,
  validatePluginConfig,
  type JsonSchema,
} from "../../src/plugins/config-schema.ts";
import { normalizeUnifiedPluginManifest } from "../../src/plugins/unified-manifest.ts";

const schema: JsonSchema = {
  type: "object",
  required: ["token", "mode", "retries", "enabled", "tags", "nullable"],
  additionalProperties: false,
  properties: {
    token: { type: "string" },
    mode: { enum: ["read", "write"] },
    retries: { type: "integer" },
    ratio: { type: "number" },
    enabled: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
    nested: { type: "object", properties: { label: { type: "string" } } },
    nullable: { type: "null" },
  },
};

describe("plugin config schema validation", () => {
  test("accepts manifest config that matches its JSON schema", () => {
    const config = {
      token: "secret",
      mode: "read",
      retries: 2,
      ratio: 0.5,
      enabled: true,
      tags: ["safe"],
      nested: { label: "demo" },
      nullable: null,
    };

    expect(() => validatePluginConfig(config, schema, "valid-plugin")).not.toThrow();
    expect(normalizeUnifiedPluginManifest({
      name: "valid-plugin",
      version: "1.0.0",
      entry: "./index.ts",
      config,
      configSchema: schema,
    }).config).toEqual(config);
  });

  test("reports all schema mismatches as validation errors", () => {
    expect(() => validatePluginConfig({
      token: 123,
      mode: "delete",
      retries: 1.5,
      enabled: "yes",
      tags: ["ok", 7],
      nested: "bad",
      nullable: undefined,
      extra: true,
    }, schema, "bad-plugin")).toThrow(PluginConfigValidationError);

    try {
      validatePluginConfig({ token: 123, mode: "delete", retries: 1.5, extra: true }, schema, "bad-plugin");
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(PluginConfigValidationError);
      const issues = (error as PluginConfigValidationError).issues.join("\n");
      expect(issues).toContain("$.enabled is required");
      expect(issues).toContain("$.token must be string");
      expect(issues).toContain('$.mode must be one of "read", "write"');
      expect(issues).toContain("$.retries must be integer");
      expect(issues).toContain("$.extra is not allowed");
    }
  });

  test("rejects non-object schemas and non-object object configs", () => {
    expect(() => validatePluginConfig({}, true, "schema-plugin")).toThrow("configSchema must be a JSON object");
    expect(() => validatePluginConfig(null, { type: "object" }, "object-plugin")).toThrow("$ must be object");
    expect(() => validatePluginConfig("nope", { type: "array", items: { type: "string" } }, "array-plugin"))
      .toThrow("$ must be array");
  });
});
