import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findApplicationSettingDefinition,
  RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
} from "../../../contracts/settings";
import { validateSettingUpdate } from "./validate-setting-update";

const cudaDefinition = findApplicationSettingDefinition(
  RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
)!;

describe("validateSettingUpdate", () => {
  it("accepts supported HTTPS PyTorch wheel channels", () => {
    assert.doesNotThrow(() => validateSettingUpdate(
      cudaDefinition,
      "https://download.pytorch.org/whl/cu130",
    ));
    assert.doesNotThrow(() => validateSettingUpdate(
      cudaDefinition,
      "https://download.pytorch.org/whl/cpu/",
    ));
  });

  it("rejects alternate origins, credentials, ports, queries, and unsupported paths", () => {
    for (const value of [
      "http://download.pytorch.org/whl/cu130",
      "https://evil.example/whl/cu130",
      "https://user:secret@download.pytorch.org/whl/cu130",
      "https://download.pytorch.org:444/whl/cu130",
      "https://download.pytorch.org/whl/cu130?index=evil",
      "https://download.pytorch.org/redirect/cu130",
    ]) {
      assert.throws(() => validateSettingUpdate(cudaDefinition, value));
    }
  });

  it("validates selectable settings against their declared options", () => {
    const definition = findApplicationSettingDefinition("runtime.python.defaultDevice")!;
    assert.doesNotThrow(() => validateSettingUpdate(definition, "cuda"));
    assert.throws(() => validateSettingUpdate(definition, "remote-shell"));
  });
});

