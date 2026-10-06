import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, INSTALLED_WEBLLM_VERSION } from "./model";

describe("DEFAULT_MODEL_ID", () => {
  it("uses the verified compact WebLLM model without extra GPU feature requirements", () => {
    const record = prebuiltAppConfig.model_list.find((model) => model.model_id === DEFAULT_MODEL_ID);

    expect(DEFAULT_MODEL_ID).toBe("SmolLM2-360M-Instruct-q4f32_1-MLC");
    expect(record).toBeDefined();
    expect(record?.required_features ?? []).toEqual([]);
  });
});

describe("INSTALLED_WEBLLM_VERSION", () => {
  it("matches the actually-installed @mlc-ai/web-llm package version, so this constant can never silently drift from reality", () => {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve("@mlc-ai/web-llm/package.json");
    const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version: string;
    };

    expect(INSTALLED_WEBLLM_VERSION).toBe(version);
  });
});
