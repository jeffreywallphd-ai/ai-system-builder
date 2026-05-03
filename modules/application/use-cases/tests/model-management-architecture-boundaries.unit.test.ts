import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../testing/node-test";

describe("model management architecture boundaries", () => {
  it("model use cases do not import persistence filesystem adapters", () => {
    const source = readFileSync(resolve("modules/application/use-cases/model/register-generated-model.use-case.ts"), "utf8");
    expect(source).not.toContain("modules/adapters/persistence");
    expect(source).not.toContain("node:fs");
  });

  it("local model registry adapter does not import UI or Hugging Face SDK", () => {
    const source = readFileSync(resolve("modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts"), "utf8");
    expect(source).not.toContain("modules/ui");
    expect(source).not.toContain("@huggingface/hub");
  });

  it("hugging face browse/details adapter uses shared inference recommendation helper", () => {
    const source = readFileSync(resolve("modules/adapters/model/huggingface/createHuggingFaceModelBrowseDetailsAdapter.ts"), "utf8");
    expect(source).toContain("recommendModelInferenceMode");
    expect(source).not.toContain("TASK_TO_INFERENCE_MODE");
  });
});
