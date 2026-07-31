import { describe, expect, it } from "../../../../testing/node-test";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import {
  isImageGenerationModelCandidate,
  isImageGenerationModelReady,
  toImageGenerationModelDropdownOption,
} from "../imageGenerationModelInventory";

function model(overrides: Partial<ModelInventoryRecord> = {}): ModelInventoryRecord {
  return {
    modelRecordId: "record-1",
    displayName: "Image Model",
    source: "huggingface",
    provider: "huggingface",
    lifecycleStatus: "downloaded",
    artifactForm: "checkpoint",
    createdAt: "2026-05-03T00:00:00.000Z",
    inferenceMode: "text-to-image",
    taskTags: ["text-to-image"],
    ...overrides,
  };
}

describe("imageGenerationModelInventory", () => {
  it("accepts the same downloaded image model forms used by the desktop image generation dropdown", () => {
    expect(isImageGenerationModelCandidate(model({ artifactForm: "checkpoint" }))).toBe(true);
    expect(isImageGenerationModelCandidate(model({ artifactForm: "full-model" }))).toBe(true);
    expect(isImageGenerationModelCandidate(model({ artifactForm: "merged-model" }))).toBe(true);
  });

  it("treats downloaded, generated, and validated image models as generation-ready", () => {
    expect(isImageGenerationModelReady(model({ lifecycleStatus: "downloaded" }))).toBe(true);
    expect(isImageGenerationModelReady(model({ lifecycleStatus: "generated" }))).toBe(true);
    expect(isImageGenerationModelReady(model({ lifecycleStatus: "validated" }))).toBe(true);
    expect(isImageGenerationModelReady(model({ lifecycleStatus: "saved-reference" }))).toBe(false);
  });

  it("builds a dropdown option for downloaded full-model image records", () => {
    const option = toImageGenerationModelDropdownOption(model({
      modelRecordId: "record-full",
      modelId: "org/sdxl-full",
      artifactForm: "full-model",
      lifecycleStatus: "downloaded",
    }));

    expect(option).toMatchObject({
      value: "record-full",
      modelRecordId: "record-full",
      ready: true,
    });
  });

  it("recognizes downloaded local image models discovered without provider task metadata", () => {
    const option = toImageGenerationModelDropdownOption(model({
      modelRecordId: "record-sdxl",
      displayName: "stabilityai/stable-diffusion-xl-base-1.0",
      modelId: "stabilityai/stable-diffusion-xl-base-1.0",
      artifactForm: "full-model",
      inferenceMode: undefined,
      taskTags: undefined,
    }));

    expect(option).toMatchObject({
      value: "record-sdxl",
      ready: true,
    });
  });

  it("does not infer non-image full-model records from local discovery alone", () => {
    expect(toImageGenerationModelDropdownOption(model({
      displayName: "Qwen/Qwen3-1.7B",
      modelId: "Qwen/Qwen3-1.7B",
      artifactForm: "full-model",
      inferenceMode: undefined,
      taskTags: undefined,
    }))).toBeUndefined();
  });

  it("rejects non-image model records", () => {
    expect(toImageGenerationModelDropdownOption(model({
      inferenceMode: "chat",
      taskTags: ["chat"],
    }))).toBeUndefined();
  });
});
