import { describe, expect, expectTypeOf, it } from "../../testing/node-test";

import type { LocalModelConfig } from "../runtime";
import {
  createFeatureModelDefaultSettingKey,
  createTaskModelDefaultSettingKey,
  findApplicationSettingDefinition,
  GLOBAL_MODEL_DEFAULT_SETTING_KEY,
  INITIAL_APPLICATION_SETTING_DEFINITIONS,
  listApplicationSettingDefinitionsByCategory,
  normalizeModelDefaultConfig,
  type ModelDefaultConfig,
} from ".";

describe("settings contracts", () => {
  it("includes required initial settings keys in the registry", () => {
    const keys = new Set(INITIAL_APPLICATION_SETTING_DEFINITIONS.map((definition) => definition.key));

    expect(keys.has("huggingface.token")).toBe(true);
    expect(keys.has("huggingface.defaultNamespace")).toBe(true);
    expect(keys.has(GLOBAL_MODEL_DEFAULT_SETTING_KEY)).toBe(true);
    expect(keys.has(createTaskModelDefaultSettingKey("qaGeneration"))).toBe(true);
    expect(keys.has(createFeatureModelDefaultSettingKey("datasetPreparation", "qaGeneration"))).toBe(true);
    expect(keys.has("runtime.imageGeneration.gpuType")).toBe(true);
    expect(keys.has("runtime.python.defaultDevice")).toBe(true);
    expect(keys.has("runtime.python.defaultTorchDtype")).toBe(true);
  });

  it("marks the Hugging Face token setting as a sensitive secret", () => {
    expect(findApplicationSettingDefinition("huggingface.token")).toMatchObject({
      valueKind: "secret",
      sensitive: true,
    });
  });

  it("keeps model defaults paired with inferenceMode when defaultValue is configured", () => {
    const global = findApplicationSettingDefinition(GLOBAL_MODEL_DEFAULT_SETTING_KEY);
    const qaTask = findApplicationSettingDefinition(createTaskModelDefaultSettingKey("qaGeneration"));

    expect(global?.defaultValue).toMatchObject({
      provider: "transformers",
      modelId: expect.any(String),
      inferenceMode: expect.any(String),
    });
    expect(qaTask?.defaultValue).toMatchObject({
      provider: "transformers",
      modelId: expect.any(String),
      inferenceMode: expect.any(String),
      device: expect.any(String),
      torchDtype: expect.any(String),
    });

    const featureOverride = findApplicationSettingDefinition(
      createFeatureModelDefaultSettingKey("datasetPreparation", "qaGeneration"),
    );
    if (featureOverride?.defaultValue) {
      expect(featureOverride.defaultValue).toMatchObject({
        provider: "transformers",
        modelId: expect.any(String),
        inferenceMode: expect.any(String),
      });
    }
  });

  it("uses desktop-safe qa task model default", () => {
    const qaTask = findApplicationSettingDefinition(createTaskModelDefaultSettingKey("qaGeneration"));
    expect(qaTask?.defaultValue).toMatchObject({
      provider: "transformers",
      modelId: "google/flan-t5-small",
      inferenceMode: "auto",
      device: "auto",
      torchDtype: "auto",
    });
  });

  it("validates model default config inferenceMode in normalizer and remains runtime-compatible", () => {
    const normalized = normalizeModelDefaultConfig({
      provider: "transformers",
      modelId: " google/flan-t5-base ",
      inferenceMode: "text2text",
      device: "auto",
    });

    expect(normalized).toEqual({
      provider: "transformers",
      modelId: "google/flan-t5-base",
      inferenceMode: "text2text",
      device: "auto",
    });

    expect(() =>
      normalizeModelDefaultConfig({
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "invalid" as unknown as ModelDefaultConfig["inferenceMode"],
      }),
    ).toThrow('Model default config inferenceMode must be one of auto, text2text, causal, chat. Received "invalid".');

    expectTypeOf<ModelDefaultConfig>().toExtend<LocalModelConfig>();
  });



  it("uses canonical value kinds for secrets and model defaults", () => {
    expect(findApplicationSettingDefinition("huggingface.token")?.valueKind).toBe("secret");
    expect(findApplicationSettingDefinition(GLOBAL_MODEL_DEFAULT_SETTING_KEY)?.valueKind).toBe("object");
    expect(findApplicationSettingDefinition(createTaskModelDefaultSettingKey("qaGeneration"))?.valueKind).toBe("object");
    expect(
      findApplicationSettingDefinition(createFeatureModelDefaultSettingKey("datasetPreparation", "qaGeneration"))?.valueKind,
    ).toBe("object");
  });

  it("requires inferenceMode whenever model default values are present", () => {
    const modelDefaultKeys = [
      GLOBAL_MODEL_DEFAULT_SETTING_KEY,
      createTaskModelDefaultSettingKey("qaGeneration"),
      createFeatureModelDefaultSettingKey("datasetPreparation", "qaGeneration"),
    ];

    for (const key of modelDefaultKeys) {
      const definition = findApplicationSettingDefinition(key);
      expect(definition).toBeDefined();
      expect(definition?.valueKind).toBe("object");
      if (!definition?.defaultValue) {
        continue;
      }

      expect(definition.defaultValue).toMatchObject({
        modelId: expect.any(String),
        inferenceMode: expect.any(String),
      });
    }
  });

  it("builds known model default setting keys for layered resolution", () => {
    expect(GLOBAL_MODEL_DEFAULT_SETTING_KEY).toBe("models.default");
    expect(createTaskModelDefaultSettingKey("qaGeneration")).toBe(
      "models.tasks.qaGeneration.default",
    );
    expect(createFeatureModelDefaultSettingKey("datasetPreparation", "qaGeneration")).toBe(
      "features.datasetPreparation.qaGeneration.default",
    );
  });

  it("filters definitions by category", () => {
    const runtimeDefinitions = listApplicationSettingDefinitionsByCategory("runtime");
    expect(runtimeDefinitions.map((definition) => definition.key).sort()).toEqual([
      "runtime.imageGeneration.gpuType",
      "runtime.python.defaultDevice",
      "runtime.python.defaultTorchDtype",
    ]);
  });
});
