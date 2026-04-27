import { describe, expect, it } from "../../../../testing/node-test";

import { DefaultModelDefaultResolver } from "../default-model-default-resolver";
import type { ApplicationSettingsPort } from "../../../ports/settings";

function createSettingsPort(values: Record<string, unknown>): ApplicationSettingsPort {
  return {
    async listDefinitions() {
      return [];
    },
    async readValues(request) {
      return (request.keys ?? []).map((key) => ({
        key,
        configured: key in values,
        value: values[key],
      }));
    },
    async updateValue(request) {
      return { key: request.key, configured: true, value: request.value };
    },
    async clearValue(request) {
      return { key: request.key, configured: false };
    },
  };
}

describe("DefaultModelDefaultResolver", () => {
  it("fails clearly for invalid configured feature override", async () => {
    const resolver = new DefaultModelDefaultResolver({
      settings: createSettingsPort({
        "features.datasetPreparation.qaGeneration.default": { modelId: "feature/model" },
      }),
    });

    await expect(resolver.resolve({ taskKey: "qaGeneration", featureKey: "datasetPreparation" })).rejects.toThrow(
      'Configured model default "features.datasetPreparation.qaGeneration.default" is invalid: must include a supported inferenceMode.',
    );
  });

  it("falls back from absent feature override to task default", async () => {
    const resolver = new DefaultModelDefaultResolver({
      settings: createSettingsPort({
        "models.tasks.qaGeneration.default": {
          provider: "transformers",
          modelId: "task/model",
          inferenceMode: "causal",
        },
      }),
    });

    const resolved = await resolver.resolve({ taskKey: "qaGeneration", featureKey: "datasetPreparation" });
    expect(resolved.source).toBe("task");
    expect(resolved.modelId).toBe("task/model");
  });

  it("fails clearly for invalid configured task default when selected", async () => {
    const resolver = new DefaultModelDefaultResolver({
      settings: createSettingsPort({
        "models.tasks.qaGeneration.default": {
          provider: "unsupported",
          modelId: "task/model",
          inferenceMode: "text2text",
        },
      }),
    });

    await expect(resolver.resolve({ taskKey: "qaGeneration" })).rejects.toThrow(
      'Configured model default "models.tasks.qaGeneration.default" is invalid: provider must be "transformers".',
    );
  });

  it("falls back from absent task default to global default", async () => {
    const resolver = new DefaultModelDefaultResolver({
      settings: createSettingsPort({
        "models.default": {
          provider: "transformers",
          modelId: "global/model",
          inferenceMode: "text2text",
        },
      }),
    });

    const resolved = await resolver.resolve({ taskKey: "qaGeneration" });
    expect(resolved.source).toBe("global");
    expect(resolved.modelId).toBe("global/model");
  });

  it("uses runtime device and torchDtype when selected model default omits them", async () => {
    const resolver = new DefaultModelDefaultResolver({
      settings: createSettingsPort({
        "models.default": {
          provider: "transformers",
          modelId: "global/model",
          inferenceMode: "text2text",
        },
        "runtime.python.defaultDevice": "cuda",
        "runtime.python.defaultTorchDtype": "float16",
      }),
    });

    const resolved = await resolver.resolve({ taskKey: "qaGeneration" });
    expect(resolved.source).toBe("global");
    expect(resolved.device).toBe("cuda");
    expect(resolved.torchDtype).toBe("float16");
  });

  it("uses builtin fallback defaults when no settings are configured", async () => {
    const resolver = new DefaultModelDefaultResolver({ settings: createSettingsPort({}) });
    const resolved = await resolver.resolve({ taskKey: "qaGeneration" });

    expect(resolved.source).toBe("builtin");
    expect(resolved.modelId).toBe("google/flan-t5-small");
    expect(resolved.inferenceMode).toBe("auto");
    expect(resolved.device).toBe("auto");
    expect(resolved.torchDtype).toBe("auto");
  });
});
