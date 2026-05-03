import { describe, expect, it } from "../../../testing/node-test";

import {
  normalizeModelArtifactForm,
  normalizeModelId,
  normalizeModelLifecycleStatus,
  normalizeModelSerializationFormat,
  normalizeModelSource,
  normalizeModelTaskTag,
  normalizeModelTaskTags,
} from "..";

describe("model domain", () => {
  it("normalizes model id and rejects empty values", () => {
    expect(normalizeModelId("  org/model-1 ")).toBe("org/model-1");
    expect(() => normalizeModelId("   ")).toThrow("Model id must be a non-empty trimmed string.");
  });

  it("normalizes source, lifecycle status, artifact form, and serialization format", () => {
    expect(normalizeModelSource(" HuggingFace ")).toBe("huggingface");
    expect(normalizeModelLifecycleStatus(" Downloaded ")).toBe("downloaded");
    expect(normalizeModelArtifactForm(" Quantized-Model ")).toBe("quantized-model");
    expect(normalizeModelSerializationFormat(" Sharded-Safetensors ")).toBe("sharded-safetensors");
  });

  it("normalizes task tags and rejects unknown values", () => {
    expect(normalizeModelTaskTag(" Question-Answering ")).toBe("question-answering");
    expect(normalizeModelTaskTags(["chat", " embeddings "])).toEqual(["chat", "embeddings"]);
    expect(() => normalizeModelTaskTag("translation")).toThrow();
  });
});
