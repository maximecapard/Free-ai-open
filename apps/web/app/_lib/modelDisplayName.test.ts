import { describe, expect, it } from "vitest";
import { modelRegistryV2 } from "@free-ai-open/model-registry";
import { hasLocalizedModelName, localizedModelName } from "./modelDisplayName";

describe("localizedModelName", () => {
  it("has a localized friendly name for every public registry model", () => {
    expect(modelRegistryV2.every((model) => hasLocalizedModelName(model.id))).toBe(true);
  });

  it("uses the translated friendly name without changing technical model ids", () => {
    const model = modelRegistryV2[0]!;
    expect(localizedModelName(model, (key) => `translated:${key}`)).toBe("translated:modelNames.compact");
    expect(model.id).toBe("smollm2-360m-instruct-q4f32");
  });
});
